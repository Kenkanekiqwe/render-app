const NOW_PLAYING_STALE_MS = 10 * 60 * 1000;

function normalizeTrack(raw) {
  if (!raw || raw.id == null) return null;
  const soundcloudUrl = String(raw.soundcloudUrl || raw.url || raw.permalink || '').slice(0, 500);
  return {
    id: raw.id,
    title: String(raw.title || '').slice(0, 200),
    artist: String(raw.artist || '').slice(0, 200),
    cover: String(raw.cover || ''),
    soundcloudUrl,
    url: soundcloudUrl,
    duration: Number(raw.duration) || 0,
  };
}

function parseTrackJson(raw) {
  if (!raw) return null;
  try {
    return normalizeTrack(JSON.parse(raw));
  } catch {
    return null;
  }
}

const PROFILE_LINK_TYPES = [
  'telegram',
  'discord',
  'youtube',
  'instagram',
  'vk',
  'twitch',
  'soundcloud',
  'spotify',
  'github',
  'x',
  'website',
];

const MAX_PROFILE_LINKS = 8;
const MAX_PROFILE_LINK_URL = 500;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TELEGRAM_USER = /^[a-zA-Z0-9_]{4,32}$/;
const DISCORD_INVITE = /^[a-zA-Z0-9-]+$/;

function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function detectLinkType(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host === 't.me' || hostIs(host, 'telegram.me') || hostIs(host, 'telegram.org')) return 'telegram';
    if (host === 'discord.gg' || hostIs(host, 'discord.com')) return 'discord';
    if (host === 'youtu.be' || hostIs(host, 'youtube.com')) return 'youtube';
    if (hostIs(host, 'instagram.com')) return 'instagram';
    if (host === 'vk.com' || host === 'vk.ru' || hostIs(host, 'vk.com') || hostIs(host, 'vk.ru')) return 'vk';
    if (hostIs(host, 'twitch.tv')) return 'twitch';
    if (hostIs(host, 'soundcloud.com')) return 'soundcloud';
    if (hostIs(host, 'spotify.com')) return 'spotify';
    if (hostIs(host, 'github.com')) return 'github';
    if (host === 'x.com' || host === 'twitter.com' || hostIs(host, 'x.com') || hostIs(host, 'twitter.com')) return 'x';
  } catch {
    // ignore
  }
  return 'website';
}

function expandShorthandUrl(raw, type) {
  const kind = String(type || '').toLowerCase();
  const atUser = raw.match(/^@([a-zA-Z0-9_]{4,32})$/);
  if (atUser) return `https://t.me/${atUser[1]}`;

  if (kind === 'telegram' && TELEGRAM_USER.test(raw)) {
    return `https://t.me/${raw}`;
  }
  if (kind === 'telegram' && /^(t\.me|telegram\.me)\//i.test(raw)) {
    return `https://${raw}`;
  }

  if (kind === 'discord' && DISCORD_INVITE.test(raw) && !/discord\.com\/users/i.test(raw)) {
    return `https://discord.gg/${raw}`;
  }
  if (kind === 'discord' && /^(discord\.gg|discord\.com\/invite)\//i.test(raw)) {
    return `https://${raw}`;
  }

  return raw;
}

function sanitizeLinkUrl(raw, type = '') {
  let value = String(raw || '').trim();
  if (!value || CONTROL_CHARS.test(value)) return '';

  value = expandShorthandUrl(value, type);

  if (!/^https?:\/\//i.test(value)) {
    if (BARE_SCHEME.test(value)) return '';
    value = `https://${value.replace(/^\/+/, '')}`;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname) return '';
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      const cleaned = url.toString();
      return cleaned.length > MAX_PROFILE_LINK_URL ? '' : cleaned;
    }
    return value.length > MAX_PROFILE_LINK_URL ? '' : value;
  } catch {
    return '';
  }
}

function normalizeProfileLinks(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const links = [];
  const seen = new Set();

  for (const item of source) {
    if (links.length >= MAX_PROFILE_LINKS) break;
    const requested = String(item?.type || '').toLowerCase();
    const known = PROFILE_LINK_TYPES.includes(requested);
    const url = sanitizeLinkUrl(item?.url || item?.href, known ? requested : '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      type: detectLinkType(url),
      url,
      label: String(item?.label || '').trim().slice(0, 32),
    });
  }

  return links;
}

function parseJsonValue(raw) {
  let value = raw;
  if (Buffer.isBuffer(value)) {
    value = value.toString('utf8');
  }
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return i === 0 ? null : value;
    }
  }
  return value;
}

function parseProfileLinksJson(raw) {
  if (raw == null || raw === '') return [];
  const value = typeof raw === 'string' || Buffer.isBuffer(raw) ? parseJsonValue(raw) : raw;
  return normalizeProfileLinks(value);
}

function parseNowPlayingJson(raw, { allowStale = false } = {}) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const track = normalizeTrack(data?.track);
    if (!track) return null;

    const updatedAt = Number(data?.updatedAt) || 0;
    if (!allowStale && updatedAt && Date.now() - updatedAt > NOW_PLAYING_STALE_MS) {
      return null;
    }

    return {
      track,
      isPlaying: Boolean(data?.isPlaying),
      updatedAt,
    };
  } catch {
    return null;
  }
}

function profileExtrasFromRow(row, { includeNowPlaying = false, allowStaleNowPlaying = false } = {}) {
  const extras = {
    pinnedTrack: parseTrackJson(row.pinned_track_json),
    links: parseProfileLinksJson(row.profile_links_json),
  };

  if (includeNowPlaying) {
    extras.nowPlaying = parseNowPlayingJson(row.now_playing_json, {
      allowStale: allowStaleNowPlaying,
    });
  }

  return extras;
}

module.exports = {
  NOW_PLAYING_STALE_MS,
  normalizeTrack,
  parseTrackJson,
  parseNowPlayingJson,
  parseProfileLinksJson,
  normalizeProfileLinks,
  profileExtrasFromRow,
};
