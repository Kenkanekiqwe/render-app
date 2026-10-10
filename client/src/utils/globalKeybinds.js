import { isDesktopApp, waitForAppWindow } from './tauri';
import { KEYBIND_ACTIONS, keybindToShortcut } from './keybinds';

function getInvoke() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core?.invoke || null;
}

function getEventListen() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.event?.listen || null;
}

export function buildGlobalKeybindEntries(keybinds) {
  if (!keybinds?.enabled) return [];

  const entries = [];
  const used = new Set();

  KEYBIND_ACTIONS.forEach((action) => {
    const shortcut = keybindToShortcut(keybinds[action]);
    if (!shortcut || used.has(shortcut)) return;
    used.add(shortcut);
    entries.push({ action, shortcut });
  });

  return entries;
}

export async function syncGlobalKeybinds(keybinds) {
  if (!isDesktopApp()) return;

  const invoke = getInvoke();
  if (!invoke) return;

  await waitForAppWindow();

  try {
    await invoke('sync_global_keybinds', {
      entries: buildGlobalKeybindEntries(keybinds),
    });
  } catch (error) {
    console.warn('Global keybind sync failed:', error);
  }
}

export async function listenGlobalKeybinds(onAction) {
  if (!isDesktopApp()) return () => {};

  const listen = getEventListen();
  if (!listen) return () => {};

  await waitForAppWindow();

  try {
    const unlisten = await listen('global-keybind', (event) => {
      if (event?.payload) onAction(event.payload);
    });
    return typeof unlisten === 'function' ? unlisten : () => {};
  } catch (error) {
    console.warn('Global keybind listener failed:', error);
    return () => {};
  }
}
