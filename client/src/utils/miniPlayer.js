import { isDesktopApp, getAppWindow, waitForAppWindow } from './tauri';

export const MINI_PLAYER_LABEL = 'mini-player';
const STATE_KEY = 'render_mini_player_state';
const ACTION_KEY = 'render_mini_player_action';
const STATE_EVENT = 'mini-player-state';
const ACTION_EVENT = 'mini-player-action';

function getTauri() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__ || null;
}

export function isMiniPlayerWindow() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('mini') === '1';
  } catch {
    return false;
  }
}

function miniPlayerUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('mini', '1');
  url.hash = '';
  return url.toString();
}

function getWebviewWindowCtor() {
  const tauri = getTauri();
  return tauri?.webviewWindow?.WebviewWindow || tauri?.window?.WebviewWindow || null;
}

async function getWindowByLabel(label) {
  const tauri = getTauri();
  const Ctor = getWebviewWindowCtor();

  try {
    if (Ctor?.getByLabel) {
      return await Ctor.getByLabel(label);
    }
    if (tauri?.webviewWindow?.getByLabel) {
      return await tauri.webviewWindow.getByLabel(label);
    }
    if (tauri?.window?.getByLabel) {
      return await tauri.window.getByLabel(label);
    }
  } catch {
    return null;
  }
  return null;
}

async function showLabeledWindow(win) {
  if (!win) return false;
  try {
    if (win.unminimize) await win.unminimize();
  } catch {
    // ignore
  }
  try {
    if (win.show) await win.show();
  } catch {
    return false;
  }
  try {
    if (win.setAlwaysOnTop) await win.setAlwaysOnTop(true);
  } catch {
    // ignore
  }
  try {
    if (win.setFocus) await win.setFocus();
  } catch {
    // ignore
  }
  return true;
}

export function readMiniPlayerState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function publishMiniPlayerState(state) {
  const payload = {
    track: state?.track ? {
      id: state.track.id,
      title: state.track.title || '',
      artist: state.track.artist || '',
      cover: state.track.cover || state.track.coverThumb || '',
    } : null,
    isPlaying: Boolean(state?.isPlaying),
    ts: Date.now(),
  };

  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }

  getTauri()?.event?.emit?.(STATE_EVENT, payload);
}

export function sendMiniPlayerAction(type) {
  const payload = { type, ts: Date.now() };
  try {
    localStorage.setItem(ACTION_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
  getTauri()?.event?.emit?.(ACTION_EVENT, payload);
}

export function listenMiniPlayerState(onState) {
  const fromStorage = (event) => {
    if (event.key !== STATE_KEY || !event.newValue) return;
    try {
      onState(JSON.parse(event.newValue));
    } catch {
      // ignore
    }
  };

  window.addEventListener('storage', fromStorage);

  let unlisten = () => {};
  const listen = getTauri()?.event?.listen;
  if (listen) {
    listen(STATE_EVENT, (event) => {
      if (event?.payload) onState(event.payload);
    }).then((fn) => {
      if (typeof fn === 'function') unlisten = fn;
    }).catch(() => {});
  }

  return () => {
    window.removeEventListener('storage', fromStorage);
    unlisten();
  };
}

export function listenMiniPlayerAction(onAction) {
  const fromStorage = (event) => {
    if (event.key !== ACTION_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload?.type) onAction(payload.type);
    } catch {
      // ignore
    }
  };

  window.addEventListener('storage', fromStorage);

  let unlisten = () => {};
  const listen = getTauri()?.event?.listen;
  if (listen) {
    listen(ACTION_EVENT, (event) => {
      const type = event?.payload?.type;
      if (type) onAction(type);
    }).then((fn) => {
      if (typeof fn === 'function') unlisten = fn;
    }).catch(() => {});
  }

  return () => {
    window.removeEventListener('storage', fromStorage);
    unlisten();
  };
}

export async function hideMainWindow() {
  const win = (await waitForAppWindow()) || getAppWindow();
  if (win?.hide) {
    try {
      await win.hide();
      return;
    } catch {
      // fall through
    }
  }
  if (win?.minimize) {
    await win.minimize();
  }
}

export async function showMainWindow() {
  const win = (await waitForAppWindow()) || getAppWindow();
  if (!win) return;
  try {
    if (win.unminimize) await win.unminimize();
  } catch {
    // ignore
  }
  try {
    if (win.show) await win.show();
  } catch {
    // ignore
  }
  try {
    if (win.setFocus) await win.setFocus();
  } catch {
    // ignore
  }
}

export async function closeMiniPlayerWindow() {
  const existing = await getWindowByLabel(MINI_PLAYER_LABEL);
  if (!existing) return;
  try {
    if (existing.hide) {
      await existing.hide();
      return;
    }
  } catch {
    // fall through
  }
  try {
    if (existing.close) await existing.close();
  } catch {
    // ignore
  }
}

export async function openMiniPlayerWindow() {
  if (!isDesktopApp()) return false;

  await waitForAppWindow();

  const existing = await getWindowByLabel(MINI_PLAYER_LABEL);
  if (existing && await showLabeledWindow(existing)) {
    return true;
  }

  const Ctor = getWebviewWindowCtor();
  if (!Ctor) return false;

  try {
    const mini = new Ctor(MINI_PLAYER_LABEL, {
      url: miniPlayerUrl(),
      title: 'Render',
      width: 280,
      height: 86,
      minWidth: 240,
      minHeight: 80,
      maxWidth: 360,
      maxHeight: 110,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      visible: true,
      skipTaskbar: true,
      focus: true,
      shadow: true,
      center: false,
    });

    if (mini?.once) {
      mini.once('tauri://error', () => {});
    }
    return showLabeledWindow(mini);
  } catch (error) {
    console.warn('Mini player window failed:', error);
    return false;
  }
}
