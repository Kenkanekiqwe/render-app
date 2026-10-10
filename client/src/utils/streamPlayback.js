export function streamInfoUrl(trackId, { refresh = false } = {}) {
  const id = String(trackId || '');
  if (!id) return '';
  return refresh ? `/api/stream/${id}/info?refresh=1` : `/api/stream/${id}/info`;
}

export function streamPlayUrl(trackId, { refresh = false, hls = false } = {}) {
  const id = String(trackId || '');
  if (!id) return '';
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', '1');
  if (hls) {
    params.set('format', 'hls');
  } else {
    params.set('proxy', '1');
  }
  return `/api/stream/${id}?${params.toString()}`;
}

export function streamDownloadUrl(trackId) {
  const id = String(trackId || '');
  if (!id) return '';
  return `/api/stream/${id}/download`;
}

export function isSameOriginMediaUrl(src) {
  const value = String(src || '');
  if (!value) return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return true;
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return (
      url.pathname.startsWith('/api/stream/')
      || url.pathname.startsWith('/api/proxy/')
      || url.pathname === '/sc-relay'
      || url.protocol === 'blob:'
    );
  } catch {
    return value.startsWith('/') && !value.startsWith('//');
  }
}

export function isEqSafeSrc(src) {
  const value = String(src || '');
  if (!value) return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return true;
  if (/workers\.dev|\/sc-relay(?:\?|$)/i.test(value) && !isSameOriginMediaUrl(value)) {
    return false;
  }
  if (/sndcdn\.com|soundcloud\.cloud|cf-hls-media|cf-media\.sndcdn/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function isEqSafeMedia(audio) {
  return isEqSafeSrc(audio?.currentSrc) || isEqSafeSrc(audio?.src);
}

export function applyPlaybackRate(audio, rate) {
  if (!audio) return;
  const value = Number(rate);
  const next = Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
  try {
    audio.defaultPlaybackRate = next;
    audio.playbackRate = next;
  } catch {
    // ignore
  }
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function normalizePlaybackRate(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(2, Math.max(0.5, value));
  const snapped = PLAYBACK_RATES.reduce((best, step) => (
    Math.abs(step - clamped) < Math.abs(best - clamped) ? step : best
  ), 1);
  return Math.abs(snapped - clamped) < 0.06 ? snapped : Math.round(clamped * 100) / 100;
}

export function formatPlaybackRate(rate) {
  const value = normalizePlaybackRate(rate);
  if (value === 1) return '1×';
  return `${String(value).replace(/\.0$/, '')}×`;
}
