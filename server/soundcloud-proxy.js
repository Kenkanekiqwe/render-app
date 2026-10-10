const axios = require('axios');
const {
  applySoundCloudTransport,
  shouldRelayMedia,
  shouldPipeThroughOrigin,
  unwrapRelayUrl,
  signRelayPath,
  verifyRelaySignature,
} = require('./outbound-proxy');

const streamUrlCache = new Map();
const STREAM_URL_TTL_MS = 12 * 60 * 1000;

const MEDIA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function augmentAxiosConfig(config = {}) {
  return applySoundCloudTransport('https://api.soundcloud.com/', config).config;
}

function axiosGet(url, config = {}) {
  const next = applySoundCloudTransport(url, config);
  return axios.get(next.url, next.config);
}

function axiosPost(url, data, config = {}) {
  const next = applySoundCloudTransport(url, config);
  return axios.post(next.url, data, next.config);
}

function shouldProxyStream() {
  return process.env.RENDER_STREAM_PROXY === '1';
}

function isAllowedMediaUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith('sndcdn.com')
      || host.endsWith('soundcloud.com')
      || host.endsWith('soundcloud.cloud')
    );
  } catch {
    return false;
  }
}

async function resolveAuthorizedMediaUrl(remoteUrl, getAccessToken) {
  if (!getAccessToken || !/api\.soundcloud\.com/i.test(remoteUrl)) {
    return remoteUrl;
  }

  const token = await getAccessToken();
  let response;
  try {
    response = await axiosGet(remoteUrl, {
      headers: {
        Accept: '*/*',
        'User-Agent': MEDIA_USER_AGENT,
        Authorization: `OAuth ${token}`,
      },
      maxRedirects: 0,
      timeout: 20000,
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
    const absolute = unwrapRelayUrl(new URL(location, remoteUrl).toString());
    return isAllowedMediaUrl(absolute) ? absolute : remoteUrl;
  }

  const location = response.headers?.location;
  if (location) {
    try {
      const absolute = unwrapRelayUrl(new URL(location, remoteUrl).toString());
      if (isAllowedMediaUrl(absolute)) {
        return absolute;
      }
    } catch {
      // fall through
    }
  }

  return remoteUrl;
}

function wrapMediaProxyUrl(url) {
  return url;
}

function unwrapMediaProxyUrl(url) {
  const raw = String(url || '');
  const markers = ['/api/proxy/media?url=', '/sc-relay?url='];
  for (const marker of markers) {
    const idx = raw.indexOf(marker);
    if (idx === -1) continue;
    try {
      const encoded = raw.slice(idx + marker.length).split('&')[0];
      const decoded = decodeURIComponent(encoded);
      return isAllowedMediaUrl(decoded) ? decoded : raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

function formatAxiosError(error, fallback) {
  const status = error?.response?.status;
  if (status) {
    return `Request failed with status code ${status}`;
  }
  return error?.message || fallback || 'Stream unavailable';
}

function invalidateStreamCache(trackId) {
  streamUrlCache.delete(String(trackId));
}

async function getCachedStream(trackId, resolveStream, { forceRefresh = false } = {}) {
  const key = String(trackId);
  if (!forceRefresh) {
    const cached = streamUrlCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return { protocol: cached.protocol, url: cached.url };
    }
  } else {
    streamUrlCache.delete(key);
  }

  const resolved = await resolveStream(trackId);
  streamUrlCache.set(key, {
    protocol: resolved.protocol,
    url: resolved.url,
    expires: Date.now() + STREAM_URL_TTL_MS,
  });
  return resolved;
}

function buildMediaRequestHeaders(req) {
  // Do NOT forward Origin/Referer to sndcdn вЂ” VPS IPs often get 403 with them.
  const headers = {
    Accept: '*/*',
    'User-Agent': MEDIA_USER_AGENT,
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  return headers;
}

function rewritePlaylistUrls(playlistText, playlistUrl) {
  const baseUrl = new URL(playlistUrl);
  return String(playlistText)
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }

      try {
        const absolute = new URL(trimmed, baseUrl).toString();
        if (!isAllowedMediaUrl(absolute)) {
          return line;
        }
        // Nested playlists (m3u8) go through our HLS rewriter; media segments through binary proxy.
        if (/\.m3u8(\?|$)/i.test(absolute)) {
          return signRelayPath(absolute) || `/api/proxy/hls?url=${encodeURIComponent(absolute)}`;
        }
        return signRelayPath(absolute) || `/api/proxy/media?url=${encodeURIComponent(absolute)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function isArtworkUrl(url) {
  return /artworks-|avatar|t\d+x\d+|\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(url || ''));
}

async function pipeRemoteResponse(remoteUrl, req, res) {
  const artwork = isArtworkUrl(remoteUrl);
  const response = await axiosGet(remoteUrl, {
    headers: buildMediaRequestHeaders(req),
    responseType: 'stream',
    timeout: artwork ? 15000 : 0,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  res.status(response.status);

  ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((name) => {
    const value = response.headers[name];
    if (value) res.setHeader(name, value);
  });

  res.setHeader('Cache-Control', artwork ? 'public, max-age=86400' : 'no-store');

  response.data.on('error', () => {
    if (!res.headersSent) {
      res.status(502).end();
      return;
    }
    res.end();
  });

  response.data.pipe(res);
}

async function serveHlsPlaylist(remoteUrl, req, res) {
  const response = await axiosGet(remoteUrl, {
    headers: buildMediaRequestHeaders(req),
    responseType: 'text',
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const rewritten = rewritePlaylistUrls(response.data, remoteUrl);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  res.send(rewritten);
}

function registerSoundCloudProxyRoutes(app, { resolveStream, getAccessToken }) {
  const resolvePlayableUrl = async (trackId, forceRefresh) => {
    const stream = await getCachedStream(trackId, resolveStream, { forceRefresh });
    const url = await resolveAuthorizedMediaUrl(stream.url, getAccessToken);
    return { ...stream, url };
  };

  app.get('/api/stream/:trackId/info', async (req, res) => {
    const trackId = String(req.params.trackId || '').trim();
    if (!/^\d+$/.test(trackId)) {
      return res.status(400).json({ error: 'Invalid track id' });
    }

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
      const stream = await resolvePlayableUrl(trackId, forceRefresh);
      const relay = shouldRelayMedia();
      const playUrl = (relay && signRelayPath(stream.url)) || stream.url;
      return res.json({
        protocol: stream.protocol,
        relay,
        url: playUrl,
        rewriteUrl: playUrl,
      });
    } catch (error) {
      return res.status(502).json({ error: formatAxiosError(error, 'Stream unavailable') });
    }
  });

  app.get('/api/stream/:trackId', async (req, res) => {
    const trackId = String(req.params.trackId || '').trim();
    if (!/^\d+$/.test(trackId)) {
      return res.status(400).json({ error: 'Invalid track id' });
    }

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const forceProxy = req.query.proxy === '1' || req.query.proxy === 'true' || shouldProxyStream();
    const wantHls = req.query.format === 'hls';

    const deliverStream = async (refresh) => {
      const stream = await resolvePlayableUrl(trackId, refresh);
      const pipe = forceProxy || shouldPipeThroughOrigin();

      if ((stream.protocol === 'hls' || wantHls) && (pipe || wantHls || req.query.rewrite === '1')) {
        return serveHlsPlaylist(stream.url, req, res);
      }

      if (pipe) {
        res.setHeader('Cache-Control', 'no-store');
        return pipeRemoteResponse(stream.url, req, res);
      }

      const signed = signRelayPath(stream.url);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, signed || stream.url);
    };

    try {
      await deliverStream(forceRefresh);
      return undefined;
    } catch (error) {
      if (!forceRefresh) {
        try {
          invalidateStreamCache(trackId);
          await deliverStream(true);
          return undefined;
        } catch (retryError) {
          return res.status(502).json({ error: formatAxiosError(retryError, 'Stream unavailable') });
        }
      }
      return res.status(502).json({ error: formatAxiosError(error, 'Stream unavailable') });
    }
  });

  app.get('/api/proxy/hls', async (req, res) => {
    const remoteUrl = String(req.query.url || '').trim();
    if (!remoteUrl || !isAllowedMediaUrl(remoteUrl)) {
      return res.status(400).json({ error: 'Invalid hls url' });
    }

    try {
      await serveHlsPlaylist(remoteUrl, req, res);
      return undefined;
    } catch (error) {
      return res.status(502).json({ error: formatAxiosError(error, 'HLS unavailable') });
    }
  });

  app.get('/api/proxy/media', async (req, res) => {
    const remoteUrl = String(req.query.url || '').trim();
    if (!remoteUrl || !isAllowedMediaUrl(remoteUrl)) {
      return res.status(400).json({ error: 'Invalid media url' });
    }

    if (!shouldPipeThroughOrigin()) {
      try {
        const dest = new URL(remoteUrl);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Location', dest.href);
        return res.status(302).end();
      } catch {
        return res.status(400).json({ error: 'Invalid media url' });
      }
    }

    try {
      await pipeRemoteResponse(remoteUrl, req, res);
      return undefined;
    } catch (error) {
      return res.status(502).json({ error: formatAxiosError(error, 'Media unavailable') });
    }
  });


  app.get('/api/stream/:trackId/download', async (req, res) => {
    const trackId = String(req.params.trackId || '').trim();
    if (!/^\d+$/.test(trackId)) {
      return res.status(400).json({ error: 'Invalid track id' });
    }
    try {
      const stream = await resolvePlayableUrl(trackId, false);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="track-${trackId}.mp3"`);
      return pipeRemoteResponse(stream.url, req, res);
    } catch (error) {
      try {
        invalidateStreamCache(trackId);
        const stream = await resolvePlayableUrl(trackId, true);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', `attachment; filename="track-${trackId}.mp3"`);
        return pipeRemoteResponse(stream.url, req, res);
      } catch (retryError) {
        return res.status(502).json({ error: formatAxiosError(retryError, 'Download unavailable') });
      }
    }
  });
  // Fallback if the Cloudflare Worker route is not installed: bounce to CDN.
  app.get('/sc-relay', (req, res) => {
    const remoteUrl = String(req.query.url || '').trim();
    const exp = String(req.query.exp || '').trim();
    const sig = String(req.query.sig || '').trim();
    if (!remoteUrl || !isAllowedMediaUrl(remoteUrl) || !verifyRelaySignature(remoteUrl, exp, sig)) {
      return res.status(401).json({ error: 'Invalid relay' });
    }
    try {
      const dest = new URL(remoteUrl);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Location', dest.href);
      return res.status(302).end();
    } catch {
      return res.status(400).json({ error: 'Invalid relay url' });
    }
  });
}

module.exports = {
  augmentAxiosConfig,
  axiosGet,
  axiosPost,
  wrapMediaProxyUrl,
  unwrapMediaProxyUrl,
  invalidateStreamCache,
  registerSoundCloudProxyRoutes,
  shouldRelayMedia,
};

