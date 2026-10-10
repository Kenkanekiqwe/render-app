export const KEYBIND_ACTIONS = [
  'volumeUp',
  'volumeDown',
  'mute',
  'playPause',
  'nextTrack',
  'prevTrack',
];

export const DEFAULT_KEYBINDS = {
  enabled: true,
  volumeStep: 5,
  // Ctrl+Alt so global OS hotkeys can register (bare Space/arrows usually fail).
  volumeUp: { code: 'ArrowUp', ctrl: true, alt: true, shift: false, meta: false },
  volumeDown: { code: 'ArrowDown', ctrl: true, alt: true, shift: false, meta: false },
  mute: { code: 'KeyM', ctrl: true, alt: true, shift: false, meta: false },
  playPause: { code: 'Space', ctrl: true, alt: true, shift: false, meta: false },
  nextTrack: { code: 'ArrowRight', ctrl: true, alt: true, shift: false, meta: false },
  prevTrack: { code: 'ArrowLeft', ctrl: true, alt: true, shift: false, meta: false },
};

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

const CODE_LABELS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

function normalizeBind(raw, fallback) {
  if (!raw || typeof raw !== 'object' || !raw.code) {
    return { ...fallback };
  }

  return {
    code: String(raw.code),
    ctrl: Boolean(raw.ctrl),
    alt: Boolean(raw.alt),
    shift: Boolean(raw.shift),
    meta: Boolean(raw.meta),
  };
}

export function normalizeKeybinds(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const step = Number(source.volumeStep);

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_KEYBINDS.enabled,
    volumeStep: Number.isFinite(step) ? Math.min(20, Math.max(1, step)) : DEFAULT_KEYBINDS.volumeStep,
    volumeUp: normalizeBind(source.volumeUp, DEFAULT_KEYBINDS.volumeUp),
    volumeDown: normalizeBind(source.volumeDown, DEFAULT_KEYBINDS.volumeDown),
    mute: normalizeBind(source.mute, DEFAULT_KEYBINDS.mute),
    playPause: normalizeBind(source.playPause, DEFAULT_KEYBINDS.playPause),
    nextTrack: normalizeBind(source.nextTrack, DEFAULT_KEYBINDS.nextTrack),
    prevTrack: normalizeBind(source.prevTrack, DEFAULT_KEYBINDS.prevTrack),
  };
}

export function formatKeyCode(code) {
  if (!code) return '';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6);
  return code;
}

export function formatKeybind(bind) {
  if (!bind?.code) return '—';
  const parts = [];
  if (bind.ctrl) parts.push('Ctrl');
  if (bind.alt) parts.push('Alt');
  if (bind.shift) parts.push('Shift');
  if (bind.meta) parts.push('Win');
  parts.push(formatKeyCode(bind.code));
  return parts.join(' + ');
}

export function matchesKeybind(event, bind) {
  if (!bind?.code || event.code !== bind.code) return false;
  return (
    Boolean(event.ctrlKey) === Boolean(bind.ctrl)
    && Boolean(event.altKey) === Boolean(bind.alt)
    && Boolean(event.shiftKey) === Boolean(bind.shift)
    && Boolean(event.metaKey) === Boolean(bind.meta)
  );
}

export function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable);
}

export function isModifierKey(code) {
  return MODIFIER_CODES.has(code);
}

export function bindFromKeyboardEvent(event) {
  return {
    code: event.code,
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
    meta: Boolean(event.metaKey),
  };
}

const SHORTCUT_KEY_MAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'space',
  Enter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
};

/** Convert app keybind to Tauri global-shortcut format (e.g. ctrl+alt+space). */
export function keybindToShortcut(bind) {
  if (!bind?.code) return null;

  const parts = [];
  if (bind.ctrl) parts.push('ctrl');
  if (bind.alt) parts.push('alt');
  if (bind.shift) parts.push('shift');
  if (bind.meta) parts.push('super');

  // OS global hotkeys need at least one modifier; bare keys conflict with typing.
  if (parts.length === 0) {
    parts.push('ctrl', 'alt');
  }

  let key = SHORTCUT_KEY_MAP[bind.code];
  if (!key) {
    if (bind.code.startsWith('Key')) key = bind.code.slice(3).toLowerCase();
    else if (bind.code.startsWith('Digit')) key = bind.code.slice(5);
    else if (bind.code.startsWith('Numpad')) key = bind.code.slice(6).toLowerCase();
    else key = bind.code.toLowerCase();
  }

  parts.push(key);
  return parts.join('+');
}

/** True when bind already has modifiers safe for global registration. */
export function isGlobalSafeKeybind(bind) {
  return Boolean(bind?.ctrl || bind?.alt || bind?.meta);
}
