const { axiosGet, axiosPost } = require('./soundcloud-proxy');
const { unwrapRelayUrl } = require('./outbound-proxy');

const API_BASE = 'https://api.soundcloud.com';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const WEB_URL = 'https://soundcloud.com';
const MOBILE_URL = 'https://m.soundcloud.com';
const LEGACY_API_BASE = 'https://api-v2.soundcloud.com';

const browserHeaders = {
  Accept: 'application/json; charset=utf-8',
  Origin: 'https://soundcloud.com',
  Referer: 'https://soundcloud.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// Official API: no Origin/Referer — datacenter IPs often get 403 with browser spoofing.
const officialHeaders = {
  Accept: 'application/json; charset=utf-8',
  'User-Agent': 'RenderMusicPlayer/1.0 (+https://render.kanekiq.ru)',
};

const apiHeaders = browserHeaders;

let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;
// Never seed legacy guest id from official app client_id when a secret is present.
let legacyClientId = process.env.SOUNDCLOUD_CLIENT_SECRET
  ? (process.env.SOUNDCLOUD_LEGACY_CLIENT_ID || null)
  : (process.env.SOUNDCLOUD_LEGACY_CLIENT_ID || process.env.SOUNDCLOUD_CLIENT_ID || null);
let legacyClientIdValidUntil = 0;
let cachedAppVersion = null;
let officialBlockedUntil = 0;

function hasOfficialCredentials() {
  return Boolean(
    process.env.SOUNDCLOUD_CLIENT_ID?.trim()
    && process.env.SOUNDCLOUD_CLIENT_SECRET?.trim()
  );
}

function useOfficialApi() {
  return hasOfficialCredentials() && Date.now() >= officialBlockedUntil;
}

function markOfficialBlocked(ms = 5 * 60 * 1000) {
  officialBlockedUntil = Date.now() + ms;
}

function toUrn(kind, id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw.startsWith('soundcloud:')) return raw;
  return `soundcloud:${kind}:${raw}`;
}

function trackUrn(id) {
  return toUrn('tracks', id);
}

function userUrn(id) {
  return toUrn('users', id);
}

function playlistUrn(id) {
  return toUrn('playlists', id);
}

function rewritePathWithUrns(pathname) {
  return String(pathname || '')
    .replace(/^\/tracks\/(\d+)(?=\/|$)/, (_, id) => `/tracks/${trackUrn(id)}`)
    .replace(/^\/users\/(\d+)(?=\/|$)/, (_, id) => `/users/${userUrn(id)}`)
    .replace(/^\/playlists\/(\d+)(?=\/|$)/, (_, id) => `/playlists/${playlistUrn(id)}`);
}

function mapOfficialEndpoint(endpoint) {
  if (!endpoint || endpoint.startsWith('http')) return endpoint;

  let path = endpoint;
  if (path.startsWith('/search/tracks')) path = path.replace('/search/tracks', '/tracks');
  else if (path.startsWith('/search/users')) path = path.replace('/search/users', '/users');
  else if (path.startsWith('/search/playlists')) path = path.replace('/search/playlists', '/playlists');

  return rewritePathWithUrns(path);
}

function mapOfficialParams(endpoint, params = {}) {
  const next = { ...params };

  if (Object.prototype.hasOwnProperty.call(next, 'linked_partitioning')) {
    next.linked_partitioning = true;
  }

  if (next.ids && !next.urns) {
    next.urns = String(next.ids)
      .split(',')
      .map((id) => trackUrn(id.trim()))
      .filter(Boolean)
      .join(',');
    delete next.ids;
  }

  if (next.representation === 'full') {
    next.show_tracks = true;
    delete next.representation;
  }

  // Official search is GET /tracks?q=… (not /search/tracks).
  if (/^\/tracks(?:\?|$)/.test(mapOfficialEndpoint(endpoint)) && next.access == null && next.q) {
    next.access = 'playable';
  }

  return next;
}

async function exchangeClientCredentials() {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID.trim();
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET.trim();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const { data } = await axiosPost(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    {
      headers: {
        Accept: 'application/json; charset=utf-8',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      timeout: 20000,
    }
  );

  if (!data?.access_token) {
    throw new Error('SoundCloud token response missing access_token');
  }

  accessToken = data.access_token;
  refreshToken = data.refresh_token || null;
  const expiresIn = Number(data.expires_in) || 3600;
  tokenExpiresAt = Date.now() + Math.max(30, expiresIn - 60) * 1000;
  return accessToken;
}

async function refreshAccessToken() {
  if (!refreshToken) {
    return exchangeClientCredentials();
  }

  const clientId = process.env.SOUNDCLOUD_CLIENT_ID.trim();
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET.trim();

  try {
    const { data } = await axiosPost(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      {
        headers: {
          Accept: 'application/json; charset=utf-8',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 20000,
      }
    );

    if (!data?.access_token) {
      throw new Error('SoundCloud refresh response missing access_token');
    }

    accessToken = data.access_token;
    // Refresh tokens are single-use — always keep the newest one.
    refreshToken = data.refresh_token || null;
    const expiresIn = Number(data.expires_in) || 3600;
    tokenExpiresAt = Date.now() + Math.max(30, expiresIn - 60) * 1000;
    return accessToken;
  } catch {
    refreshToken = null;
    return exchangeClientCredentials();
  }
}

async function getAccessToken({ force = false } = {}) {
  if (!hasOfficialCredentials()) {
    throw new Error(
      'Set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET (see https://developers.soundcloud.com/docs/api/register-app)'
    );
  }

  if (!force && accessToken && tokenExpiresAt > Date.now()) {
    return accessToken;
  }

  if (!force && refreshToken) {
    return refreshAccessToken();
  }

  return exchangeClientCredentials();
}

async function resolveAppVersion() {
  if (cachedAppVersion) return cachedAppVersion;
  try {
    const { data } = await axiosGet(`${WEB_URL}/versions.json`, {
      headers: apiHeaders,
      timeout: 10000,
    });
    if (data?.app) {
      cachedAppVersion = String(data.app);
      return cachedAppVersion;
    }
  } catch {
    // ignore
  }
  cachedAppVersion = process.env.SOUNDCLOUD_APP_VERSION || '1785928841';
  return cachedAppVersion;
}

async function scrapeLegacyClientId() {
  if (legacyClientId && legacyClientIdValidUntil > Date.now()) {
    return legacyClientId;
  }

  if (legacyClientId) {
    try {
      await axiosGet(`${LEGACY_API_BASE}/search/tracks`, {
        params: { q: 'music', client_id: legacyClientId, limit: 1 },
        headers: browserHeaders,
        timeout: 10000,
      });
      legacyClientIdValidUntil = Date.now() + 10 * 60 * 1000;
      return legacyClientId;
    } catch {
      legacyClientId = null;
      legacyClientIdValidUntil = 0;
    }
  }

  const pages = [
    { url: WEB_URL, headers: browserHeaders },
    {
      url: MOBILE_URL,
      headers: {
        ...browserHeaders,
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ];

  for (const page of pages) {
    try {
      const { data: html } = await axiosGet(page.url, {
        headers: page.headers,
        timeout: 15000,
      });

      const mobileMatch = String(html).match(/"clientId"\s*:\s*"([0-9a-zA-Z]{16,})"/);
      if (mobileMatch) {
        legacyClientId = mobileMatch[1];
        legacyClientIdValidUntil = Date.now() + 10 * 60 * 1000;
        return legacyClientId;
      }

      const scripts = [...String(html).matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((src) => /a-v2\.sndcdn\.com|sndcdn\.com\/assets/i.test(src));

      for (const src of [...scripts].reverse()) {
        try {
          const { data: script } = await axiosGet(src, {
            headers: page.headers,
            timeout: 12000,
          });
          const match = String(script).match(/client_id\s*:\s*"([0-9a-zA-Z]{32})"/);
          if (match) {
            legacyClientId = match[1];
            legacyClientIdValidUntil = Date.now() + 10 * 60 * 1000;
            return legacyClientId;
          }
        } catch {
          // try next bundle
        }
      }
    } catch {
      // try next page
    }
  }

  throw new Error('Не удалось получить SoundCloud Client ID');
}

function buildOfficialUrl(endpoint, params = {}) {
  const mapped = mapOfficialEndpoint(endpoint);
  const baseUrl = mapped.startsWith('http') ? mapped : `${API_BASE}${mapped}`;
  const url = new URL(baseUrl);
  const mappedParams = mapOfficialParams(endpoint, params);

  Object.entries(mappedParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function officialGet(endpoint, params = {}) {
  const requestOnce = async (forceToken) => {
    const token = await getAccessToken({ force: forceToken });
    return axiosGet(buildOfficialUrl(endpoint, params), {
      headers: {
        ...officialHeaders,
        Authorization: `OAuth ${token}`,
      },
      timeout: 20000,
    });
  };

  try {
    const response = await requestOnce(false);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401) {
      const response = await requestOnce(true);
      return response.data;
    }
    if (status === 403) {
      markOfficialBlocked();
      const err = new Error('Official SoundCloud API returned 403');
      err.status = 403;
      err.cause = error;
      throw err;
    }
    throw error;
  }
}

function toLegacyEndpoint(endpoint) {
  if (!endpoint || endpoint.startsWith('http')) {
    // Absolute URLs (incl. media/stream progressive) must keep soundcloud:tracks: in the path.
    return String(endpoint || '').replace(API_BASE, LEGACY_API_BASE);
  }

  let path = endpoint;
  if (path === '/tracks' || path.startsWith('/tracks?')) {
    path = path.replace('/tracks', '/search/tracks');
  } else if (path === '/users' || path.startsWith('/users?')) {
    path = path.replace('/users', '/search/users');
  } else if (path === '/playlists' || path.startsWith('/playlists?')) {
    path = path.replace('/playlists', '/search/playlists');
  }

  return path
    .replace(/\/tracks\/soundcloud:tracks:/g, '/tracks/')
    .replace(/\/users\/soundcloud:users:/g, '/users/')
    .replace(/\/playlists\/soundcloud:playlists:/g, '/playlists/');
}

function toLegacyParams(params = {}) {
  const next = { ...params };
  if (next.urns && !next.ids) {
    next.ids = String(next.urns)
      .split(',')
      .map((urn) => String(urn).replace(/^soundcloud:tracks:/, '').trim())
      .filter(Boolean)
      .join(',');
    delete next.urns;
  }
  if (next.access) delete next.access;
  if (next.linked_partitioning === true) next.linked_partitioning = 1;
  return next;
}

async function legacyGet(endpoint, params = {}) {
  const legacyEndpoint = toLegacyEndpoint(endpoint);
  const legacyParams = toLegacyParams(params);

  const requestOnce = async () => {
    const clientId = await scrapeLegacyClientId();
    const appVersion = await resolveAppVersion();
    const baseUrl = legacyEndpoint.startsWith('http')
      ? legacyEndpoint
      : `${LEGACY_API_BASE}${legacyEndpoint}`;
    const url = new URL(baseUrl);

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('app_version', appVersion);

    Object.entries(legacyParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    return axiosGet(url.toString(), {
      headers: browserHeaders,
      timeout: 20000,
    });
  };

  try {
    const response = await requestOnce();
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      legacyClientId = null;
      legacyClientIdValidUntil = 0;
      const response = await requestOnce();
      return response.data;
    }
    throw error;
  }
}

async function scGet(endpoint, params = {}) {
  if (hasOfficialCredentials() && Date.now() >= officialBlockedUntil) {
    try {
      return await officialGet(endpoint, params);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      // 403/429: VPS often blocked; 404: endpoint may be legacy-only (e.g. /charts).
      if (status === 403 || status === 429 || status === 404) {
        return legacyGet(endpoint, params);
      }
      throw error;
    }
  }
  return legacyGet(endpoint, params);
}

async function resolveLegacyTrackStreams(trackId) {
  const urn = trackUrn(trackId);
  const candidates = [`/tracks/${trackId}`, `/tracks/${urn}`];
  let track = null;
  for (const path of candidates) {
    try {
      track = await legacyGet(path);
      if (Array.isArray(track?.media?.transcodings) && track.media.transcodings.length) {
        break;
      }
    } catch {
      // try next
    }
  }

  if (!track) throw new Error('Track not found');

  const transcodings = Array.isArray(track.media?.transcodings) ? track.media.transcodings : [];
  const pick = (protocol) => {
    const matched = transcodings.filter((item) => {
      const itemProtocol = String(item?.format?.protocol || '');
      if (protocol === 'progressive') {
        return itemProtocol === 'progressive' || /progressive/i.test(item?.url || '');
      }
      return itemProtocol === 'hls' || /hls|m3u8/i.test(item?.url || '');
    });
    return (
      matched.find((item) => /mpeg|mp3/i.test(item?.format?.mime_type || ''))
      || matched[0]
      || null
    );
  };

  const hlsCandidates = transcodings.filter((item) =>
    String(item?.format?.protocol || '').toLowerCase() === 'hls'
    || /hls|m3u8/i.test(item?.url || '')
  );
  const aacHls = hlsCandidates.find((item) =>
    /aac|mp4/i.test(String(item?.format?.mime_type || ''))
    || /hls_aac_(160|96)/i.test(String(item?.url || ''))
  );
  const hls = aacHls || pick('hls');
  const progressive = pick('progressive');
  // AAC HLS is SoundCloud's current supported stream format. Use legacy
  // progressive MP3 only as a last-resort compatibility fallback.
  const chosen = hls || progressive;
  if (!chosen?.url) {
    throw new Error('No playable stream (empty transcodings)');
  }

  const streamMeta = await legacyGet(chosen.url);
  if (!streamMeta?.url) throw new Error('Stream URL is missing');

  return {
    protocol: chosen === progressive ? 'progressive' : 'hls',
    url: streamMeta.url,
  };
}

async function expandOfficialStreamUrl(streamUrl) {
  if (!/api\.soundcloud\.com/i.test(streamUrl)) {
    return streamUrl;
  }

  const token = await getAccessToken();
  let response;
  try {
    response = await axiosGet(streamUrl, {
      headers: {
        Accept: '*/*',
        'User-Agent': officialHeaders['User-Agent'],
        Authorization: `OAuth ${token}`,
      },
      maxRedirects: 0,
      timeout: 20000,
      maxContentLength: 64 * 1024,
      responseType: 'arraybuffer',
      validateStatus: (status) =>
        (status >= 200 && status < 400)
        || status === 301
        || status === 302
        || status === 303
        || status === 307
        || status === 308,
    });
  } catch (error) {
    const location = error?.response?.headers?.location;
    if (!location) throw error;
    return unwrapRelayUrl(new URL(location, streamUrl).toString());
  }

  const location = response.headers?.location;
  if (!location) return streamUrl;
  return unwrapRelayUrl(new URL(location, streamUrl).toString());
}

async function resolveTrackStreams(trackId) {
  const urn = trackUrn(trackId);

  // Always try official /streams when credentials exist — search may be IP-blocked
  // while stream metadata still works (and vice versa).
  if (hasOfficialCredentials()) {
    try {
      const streams = await officialGet(`/tracks/${urn}/streams`);
      // SoundCloud removed progressive MP3 from the official streams response.
      // Prefer current AAC HLS formats; old MP3 fields are only compatibility fallbacks.
      const pick =
        streams?.hls_aac_160_url
          ? { protocol: 'hls', url: streams.hls_aac_160_url }
          : streams?.hls_aac_96_url
            ? { protocol: 'hls', url: streams.hls_aac_96_url }
            : streams?.hls_mp3_128_url
              ? { protocol: 'hls', url: streams.hls_mp3_128_url }
              : streams?.http_mp3_128_url
                ? { protocol: 'progressive', url: streams.http_mp3_128_url }
                : streams?.preview_mp3_128_url
                  ? { protocol: 'progressive', url: streams.preview_mp3_128_url }
                  : null;

      if (pick?.url) {
        const expanded = await expandOfficialStreamUrl(pick.url);
        // Browser cannot send OAuth — only return CDN (or non-api) URLs.
        if (!/api\.soundcloud\.com/i.test(expanded)) {
          return { protocol: pick.protocol, url: expanded };
        }
      }
    } catch {
      // fall through to legacy api-v2 transcodings
    }
  }

  return resolveLegacyTrackStreams(trackId);
}

async function warmUp() {
  if (hasOfficialCredentials()) {
    try {
      await getAccessToken();
      await officialGet('/tracks', { q: 'music', limit: 1, linked_partitioning: true, access: 'playable' });
      return { mode: 'official' };
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status === 403 || status === 429) {
        markOfficialBlocked();
      } else {
        markOfficialBlocked(60 * 1000);
      }
    }
  }

  await scrapeLegacyClientId();
  return {
    mode: 'legacy',
    officialConfigured: hasOfficialCredentials(),
    officialBlocked: hasOfficialCredentials() && Date.now() < officialBlockedUntil,
  };
}

module.exports = {
  API_BASE,
  apiHeaders,
  scGet,
  warmUp,
  useOfficialApi,
  hasOfficialCredentials,
  getAccessToken,
  trackUrn,
  userUrn,
  playlistUrn,
  resolveTrackStreams,
};
