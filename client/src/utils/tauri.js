/** Tauri v2 window helpers for the desktop shell (no-op in the browser). */

function getTauri() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__ || null;
}

export function isDesktopApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

/** Desktop WebView2 — lighter animations and fewer background effects. */
export function isLowPowerMode() {
  return isDesktopApp();
}

export function getAppWindow() {
  const tauri = getTauri();
  if (tauri?.window?.getCurrentWindow) {
    return tauri.window.getCurrentWindow();
  }
  return null;
}

export async function waitForAppWindow(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const win = getAppWindow();
    if (win) return win;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** Pause heavy UI work when desktop window is unfocused/minimized. */
export async function listenAppActive(onActive) {
  if (!isDesktopApp()) return () => {};

  const listen = getTauri()?.event?.listen;
  if (!listen) return () => {};

  await waitForAppWindow();

  try {
    const unlisten = await listen('app-active', (event) => {
      onActive(Boolean(event?.payload));
    });
    return typeof unlisten === 'function' ? unlisten : () => {};
  } catch {
    return () => {};
  }
}

export async function minimizeWindow() {
  const win = getAppWindow();
  if (win?.minimize) return win.minimize();
  return null;
}

export async function toggleMaximizeWindow() {
  const win = getAppWindow();
  if (win?.toggleMaximize) return win.toggleMaximize();
  return null;
}

export async function closeWindow() {
  const win = getAppWindow();
  if (win?.close) return win.close();
  return null;
}

export async function isWindowMaximized() {
  const win = getAppWindow();
  if (win?.isMaximized) return win.isMaximized();
  return false;
}
