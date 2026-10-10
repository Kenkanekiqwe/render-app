const SNDCDN_ART = 'https://i1.sndcdn.com';
const SNDCDN_MEDIA = 'https://cf-media.sndcdn.com';

function nestedRelayTarget(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, 'https://render.local');
    const nested = parsed.searchParams.get('url');
    if (nested && /^https?:\/\//i.test(nested)) {
      return nested;
    }
  } catch {
    // ignore
  }
  const marker = 'url=';
  const idx = text.indexOf(marker);
  if (idx === -1) return '';
  try {
    return decodeURIComponent(text.slice(idx + marker.length).split('&')[0]) || '';
  } catch {
    return '';
  }
}

export function resolvePublicMediaUrl(url, fallback = '') {
  const raw = String(url || '').trim();
  if (!raw) return fallback;

  const nested = nestedRelayTarget(raw);
  if (nested) return nested;

  try {
    const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://render.local');
    const path = parsed.pathname || '';
    const onAppHost = !parsed.hostname
      || parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || /kanekiq\.ru$/i.test(parsed.hostname);

    if (onAppHost && /^\/(?:artworks-|avatars-|images\/)/i.test(path)) {
      return `${SNDCDN_ART}${path}`;
    }
    if (onAppHost && /\.(mp3|ogg|m4a)(?:$|\?)/i.test(path)) {
      return `${SNDCDN_MEDIA}${path}${parsed.search || ''}`;
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
  } catch {
    // keep raw
  }

  return raw || fallback;
}
