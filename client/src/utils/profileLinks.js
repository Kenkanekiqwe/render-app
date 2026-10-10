export const PROFILE_LINK_TYPES = [
  { id: 'telegram', label: 'Telegram', placeholder: 'https://t.me/username' },
  { id: 'discord', label: 'Discord', placeholder: 'https://discord.gg/invite' },
  { id: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@channel' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/username' },
  { id: 'vk', label: 'VK', placeholder: 'https://vk.com/username' },
  { id: 'twitch', label: 'Twitch', placeholder: 'https://twitch.tv/username' },
  { id: 'soundcloud', label: 'SoundCloud', placeholder: 'https://soundcloud.com/username' },
  { id: 'spotify', label: 'Spotify', placeholder: 'https://open.spotify.com/user/id' },
  { id: 'github', label: 'GitHub', placeholder: 'https://github.com/username' },
  { id: 'x', label: 'X', placeholder: 'https://x.com/username' },
  { id: 'website', label: 'Сайт', placeholder: 'https://example.com' },
];

export const MAX_PROFILE_LINKS = 8;
const MAX_PROFILE_LINK_URL = 500;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TELEGRAM_USER = /^[a-zA-Z0-9_]{4,32}$/;
const DISCORD_INVITE = /^[a-zA-Z0-9-]+$/;

function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectProfileLinkType(url) {
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

export function normalizeProfileLinkUrl(raw, type = '') {
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

export function normalizeProfileLinks(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const links = [];
  const seen = new Set();

  for (const item of source) {
    if (links.length >= MAX_PROFILE_LINKS) break;
    const requested = String(item?.type || '').toLowerCase();
    const known = PROFILE_LINK_TYPES.some((entry) => entry.id === requested);
    const url = normalizeProfileLinkUrl(item?.url, known ? requested : '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      type: detectProfileLinkType(url),
      url,
      label: String(item?.label || '').trim().slice(0, 32),
    });
  }

  return links;
}

export function emptyProfileLink(type = 'website') {
  return { type, url: '', label: '' };
}

export function profileLinkMeta(type) {
  return PROFILE_LINK_TYPES.find((entry) => entry.id === type) || PROFILE_LINK_TYPES[PROFILE_LINK_TYPES.length - 1];
}
