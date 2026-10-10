import { isDesktopApp } from './tauri';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function normalizeExternalUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed)) return '';

  let value = trimmed;
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
      return url.toString();
    }
    return value;
  } catch {
    return '';
  }
}

async function openWithTauri(url) {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!tauri?.core?.invoke) return false;

  try {
    await tauri.core.invoke('plugin:opener|open_url', { url });
    return true;
  } catch {
    return false;
  }
}

export async function openExternalUrl(url) {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return;

  if (isDesktopApp()) {
    const opened = await openWithTauri(normalized);
    if (opened) return;
  }

  const popup = window.open(normalized, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.location.assign(normalized);
  }
}
