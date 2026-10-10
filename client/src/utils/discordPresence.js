import axios from 'axios';
import { isDesktopApp } from './tauri';

/** @typedef {{ title?: string, name?: string, artist?: string, cover?: string, isPlaying?: boolean, idle?: boolean }} PresenceInput */

const DISCORD_PRESENCE_EVENT = 'discord-presence-update';

const IDLE = {
  title: 'Render',
  artist: 'SoundCloud',
  cover: '',
  isPlaying: false,
  idle: true,
};

let lastSignature = '';
let latestSignature = '';
let presenceQueue = Promise.resolve();
let initialized = false;

function getTauriBridge() {
  if (typeof window === 'undefined' || !isDesktopApp()) {
    return null;
  }
  return window.__TAURI__ ?? null;
}

function isLocalHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function pickTitle(input = {}) {
  return String(input.title || input.name || '').trim();
}

function normalizeInput(input = {}) {
  if (input.idle) {
    return { ...IDLE };
  }

  const title = pickTitle(input);
  if (!title) {
    return { ...IDLE };
  }

  return {
    title: title.slice(0, 128),
    artist: (String(input.artist || '').trim() || 'SoundCloud').slice(0, 128),
    cover: String(input.cover || '').trim(),
    isPlaying: Boolean(input.isPlaying),
    idle: false,
  };
}

function signatureOf(data) {
  return `${data.idle ? 'idle' : 'track'}\n${data.title}\n${data.artist}\n${data.cover}\n${data.isPlaying ? 1 : 0}`;
}

function enqueuePresence(task) {
  const run = presenceQueue.then(task, task);
  presenceQueue = run.catch(() => {});
  return run;
}

function buildPayload(data) {
  return {
    title: data.title,
    artist: data.artist,
    cover: data.cover,
    isPlaying: data.isPlaying,
    idle: data.idle,
  };
}

async function invokeDesktop(data) {
  const tauri = getTauriBridge();
  if (!tauri) {
    return false;
  }

  const payload = buildPayload(data);

  // Events work reliably from remote URL; invoke needs ACL + rebuild.
  if (tauri.event?.emit) {
    await tauri.event.emit(DISCORD_PRESENCE_EVENT, payload);
    return true;
  }

  const invoke = tauri.core?.invoke;
  if (!invoke) {
    return false;
  }

  await invoke('update_discord_presence', { payload });
  return true;
}

async function invokeLocalServer(data) {
  if (!isLocalHost()) {
    return false;
  }

  try {
    const { data: res } = await axios.post('/api/discord-presence', buildPayload(data));
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

async function dispatchPresence(data) {
  if (isDesktopApp()) {
    return invokeDesktop(data);
  }
  return invokeLocalServer(data);
}

/** Build presence payload from a player track object. */
export function presenceFromTrack(track, isPlaying = false) {
  if (!track) {
    return { idle: true };
  }

  return {
    title: track.title || track.name || '',
    artist: track.artist || track.user?.username || '',
    cover: track.cover || track.coverThumb || '',
    isPlaying,
  };
}

/** Call once on app start. Desktop idle is already set in Rust on launch. */
export async function initDiscordPresence() {
  if (initialized) {
    return updateDiscordPresence(IDLE);
  }

  initialized = true;

  if (isDesktopApp()) {
    return true;
  }

  return updateDiscordPresence(IDLE);
}

/** Sync Discord Rich Presence. */
export async function updateDiscordPresence(input = {}) {
  const data = normalizeInput(input);
  const signature = signatureOf(data);

  if (signature === lastSignature) {
    return true;
  }

  latestSignature = signature;

  return enqueuePresence(async () => {
    if (signature !== latestSignature) {
      return false;
    }

    try {
      const ok = await dispatchPresence(data);
      if (ok && signature === latestSignature) {
        lastSignature = signature;
      } else if (!ok) {
        console.warn('[discord] presence dispatch returned false', data);
      }
      return ok;
    } catch (error) {
      console.warn('[discord] presence failed:', error, data);
      return false;
    }
  });
}

/** Only used when the app closes. */
export async function clearDiscordPresence() {
  lastSignature = '';
  latestSignature = '';
  initialized = false;
  presenceQueue = Promise.resolve();

  const tauri = getTauriBridge();
  const invoke = tauri?.core?.invoke;
  if (!invoke) return false;

  try {
    await invoke('clear_discord_presence');
    return true;
  } catch {
    return false;
  }
}
