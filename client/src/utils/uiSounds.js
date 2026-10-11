export const UI_SOUND_STYLES = [
  { id: 'soft', labelKey: 'uiSoundSoft' },
  { id: 'crisp', labelKey: 'uiSoundCrisp' },
  { id: 'warm', labelKey: 'uiSoundWarm' },
  { id: 'minimal', labelKey: 'uiSoundMinimal' },
];

export const MAJESTIC_SOUND_STYLES = [
  { id: 'confirm', labelKey: 'uiSoundConfirm' },
  { id: 'warning', labelKey: 'uiSoundWarning' },
  { id: 'message', labelKey: 'uiSoundMessage' },
  { id: 'hover', labelKey: 'uiSoundHover' },
];

export const UI_SOUND_PACKS = [
  { id: 'builtin', labelKey: 'uiSoundPackBuiltin' },
  { id: 'majestic', labelKey: 'uiSoundPackMajestic' },
];

const MAJESTIC_STATIC = 'https://cdn.majestic-files.com/public/master/static';
const MAJESTIC_SOUNDS = `${MAJESTIC_STATIC}/sounds`;

const BUILTIN_STYLE_IDS = UI_SOUND_STYLES.map((item) => item.id);
const MAJESTIC_STYLE_IDS = MAJESTIC_SOUND_STYLES.map((item) => item.id);

const CUSTOM_FILES = {
  nav: '/sounds/nav.mp3',
  click: '/sounds/click.mp3',
  play: '/sounds/play.mp3',
  like: '/sounds/like.mp3',
  pause: '/sounds/pause.mp3',
};

const STYLE_PRESETS = {
  soft: { gain: 1, pitch: 1, type: 'sine' },
  crisp: { gain: 0.85, pitch: 1.35, type: 'triangle' },
  warm: { gain: 1.1, pitch: 0.82, type: 'sine' },
  minimal: { gain: 0.55, pitch: 1, type: 'sine' },
};

const SOUND_PROFILES = {
  nav: [{ f: 740, d: 0.07 }, { f: 980, d: 0.09, delay: 0.045 }],
  click: [{ f: 620, d: 0.05, type: 'triangle' }],
  play: [{ f: 523.25, d: 0.08 }, { f: 659.25, d: 0.1, delay: 0.06 }],
  pause: [{ f: 659.25, d: 0.07 }, { f: 523.25, d: 0.09, delay: 0.05 }],
  like: [
    { f: 392, d: 0.1 },
    { f: 493.88, d: 0.12, delay: 0.04 },
    { f: 587.33, d: 0.14, delay: 0.08 },
  ],
  callRing: [
    { f: 659.25, d: 0.28, type: 'triangle' },
    { f: 830.61, d: 0.30, delay: 0.10, type: 'sine' },
    { f: 987.77, d: 0.34, delay: 0.22, type: 'triangle' },
    { f: 1318.51, d: 0.40, delay: 0.34, type: 'sine' },
    { f: 987.77, d: 0.28, delay: 0.92, type: 'triangle' },
    { f: 1174.66, d: 0.34, delay: 1.04, type: 'sine' },
  ],
  callShare: [
    { f: 587.33, d: 0.075, type: 'sine' },
    { f: 880, d: 0.12, delay: 0.055, type: 'triangle' },
    { f: 1174.66, d: 0.16, delay: 0.11, type: 'sine' },
  ],
  callEnd: [
    { f: 783.99, d: 0.1, type: 'sine' },
    { f: 587.33, d: 0.14, delay: 0.07, type: 'triangle' },
    { f: 440, d: 0.18, delay: 0.14, type: 'sine' },
  ],
};

let soundsEnabled = true;
let masterVolume = 0.35;
let soundStyle = 'soft';
let soundPack = 'builtin';
let incomingRingTimer = null;
let incomingRingGeneration = 0;
let customRingAudio = null;
let customRingObjectUrl = null;
let ringPreviewTimer = null;

const RING_DB_NAME = 'render-app-call-ringtones';
const RING_STORE_NAME = 'ringtones';

function openRingtoneDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(RING_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RING_STORE_NAME)) request.result.createObjectStore(RING_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open ringtone storage'));
  });
}

async function readCustomRingtone() {
  const db = await openRingtoneDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(RING_STORE_NAME, 'readonly').objectStore(RING_STORE_NAME).get('incoming');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read ringtone'));
    });
  } finally { db.close(); }
}

export async function setCustomIncomingRingtone(file) {
  const audioExtension = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(file?.name || '');
  if (!file || (!file.type?.startsWith('audio/') && !audioExtension)) throw new Error('Choose an audio file');
  const db = await openRingtoneDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(RING_STORE_NAME, 'readwrite').objectStore(RING_STORE_NAME).put({ blob: file, name: file.name, type: file.type }, 'incoming');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not save ringtone'));
    });
  } finally { db.close(); }
  return file.name;
}

export async function clearCustomIncomingRingtone() {
  const db = await openRingtoneDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(RING_STORE_NAME, 'readwrite').objectStore(RING_STORE_NAME).delete('incoming');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not remove ringtone'));
    });
  } finally { db.close(); }
  stopIncomingCallRing();
}


const fileCache = {};
let audioContext;

export function getUiSoundStyles(pack = soundPack) {
  return pack === 'majestic' ? MAJESTIC_SOUND_STYLES : UI_SOUND_STYLES;
}

export function getDefaultUiSoundStyle(pack = 'builtin') {
  return pack === 'majestic' ? MAJESTIC_SOUND_STYLES[0].id : UI_SOUND_STYLES[0].id;
}

export function isValidUiSoundStyle(style, pack = soundPack) {
  const valid = pack === 'majestic' ? MAJESTIC_STYLE_IDS : BUILTIN_STYLE_IDS;
  return valid.includes(style);
}

export function setUiSoundConfig({ enabled, volume, style, pack } = {}) {
  if (typeof enabled === 'boolean') soundsEnabled = enabled;
  if (typeof volume === 'number') masterVolume = Math.min(1, Math.max(0, volume));

  if (typeof pack === 'string' && UI_SOUND_PACKS.some((item) => item.id === pack)) {
    soundPack = pack;
  }

  if (typeof style === 'string') {
    if (isValidUiSoundStyle(style, soundPack)) {
      soundStyle = style;
    } else {
      soundStyle = getDefaultUiSoundStyle(soundPack);
    }
  }
}

export function setUiSoundsEnabled(enabled) {
  soundsEnabled = Boolean(enabled);
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playTone({ frequency, duration = 0.08, volume = 0.12, type = 'sine', delay = 0 }) {
  const ctx = getAudioContext();
  const preset = STYLE_PRESETS[soundStyle] || STYLE_PRESETS.soft;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  const peak = volume * preset.gain;

  osc.type = type || preset.type;
  osc.frequency.setValueAtTime(frequency * preset.pitch, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playProcedural(name, volume = 1) {
  const profile = SOUND_PROFILES[name] || SOUND_PROFILES.click;
  const v = volume * masterVolume * (name === 'callRing' ? 0.34 : 0.14);

  profile.forEach((tone) => {
    playTone({
      frequency: tone.f,
      duration: tone.d,
      volume: v,
      type: tone.type,
      delay: tone.delay || 0,
    });
  });
}

function getMajesticStyleUrl(styleId) {
  if (styleId === 'hover') {
    return `${MAJESTIC_SOUNDS}/ipad/apps/organization/hub/tablet_cell_hover.ogg`;
  }
  return `${MAJESTIC_SOUNDS}/${styleId}.ogg`;
}

function getMajesticSrc(name) {
  if (MAJESTIC_STYLE_IDS.includes(soundStyle)) {
    return getMajesticStyleUrl(soundStyle);
  }

  const fallbackByEvent = {
    click: 'confirm',
    nav: 'confirm',
    play: 'confirm',
    pause: 'warning',
    like: 'message',
  };

  const file = fallbackByEvent[name] || 'confirm';
  return getMajesticStyleUrl(file);
}

function getSoundSrc(name) {
  if (soundPack === 'majestic') {
    return getMajesticSrc(name);
  }
  return CUSTOM_FILES[name];
}

function getCacheKey(name) {
  if (soundPack === 'majestic') {
    return `majestic:${soundStyle}:${name}`;
  }
  return `builtin:${name}`;
}

async function tryPlayFile(name, volume) {
  const src = getSoundSrc(name);
  if (!src) return false;

  const cacheKey = getCacheKey(name);

  try {
    if (!fileCache[cacheKey]) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      fileCache[cacheKey] = audio;
    }
    const audio = fileCache[cacheKey];
    if (audio.src !== src) {
      audio.src = src;
      audio.load();
    }
    audio.volume = Math.min(1, volume * masterVolume);
    audio.currentTime = 0;
    await audio.play();
    return true;
  } catch {
    delete fileCache[cacheKey];
    return false;
  }
}

function playIncomingRingPulse() {
  if (!soundsEnabled) return;
  playProcedural('callRing', 1.6);
}

async function startCustomRingIfAvailable(generation) {
  try {
    const saved = await readCustomRingtone();
    if (!saved?.blob || generation !== incomingRingGeneration || !soundsEnabled) return false;
    if (customRingAudio) { customRingAudio.pause(); customRingAudio = null; }
    if (customRingObjectUrl) URL.revokeObjectURL(customRingObjectUrl);
    customRingObjectUrl = URL.createObjectURL(saved.blob);
    customRingAudio = new Audio(customRingObjectUrl);
    customRingAudio.loop = true;
    customRingAudio.preload = 'auto';
    customRingAudio.volume = Math.min(1, Math.max(0.05, masterVolume * 1.45));
    await customRingAudio.play();
    return true;
  } catch {
    return false;
  }
}

export function startIncomingCallRing() {
  stopIncomingCallRing();
  if (!soundsEnabled) return;
  const generation = incomingRingGeneration;
  startCustomRingIfAvailable(generation).then((played) => {
    if (generation !== incomingRingGeneration || played || !soundsEnabled) return;
    playIncomingRingPulse();
    incomingRingTimer = window.setInterval(playIncomingRingPulse, 2400);
  });
}

export function previewIncomingCallRing() {
  stopIncomingCallRing();
  if (!soundsEnabled) return;
  const generation = incomingRingGeneration;
  startCustomRingIfAvailable(generation).then((played) => {
    if (generation !== incomingRingGeneration) return;
    if (played) {
      ringPreviewTimer = window.setTimeout(() => stopIncomingCallRing(), 5000);
      return;
    }
    playIncomingRingPulse();
    ringPreviewTimer = window.setTimeout(() => stopIncomingCallRing(), 3600);
  });
}

export function stopIncomingCallRing() {
  incomingRingGeneration += 1;
  if (incomingRingTimer) {
    clearInterval(incomingRingTimer);
    incomingRingTimer = null;
  }
  if (ringPreviewTimer) {
    clearTimeout(ringPreviewTimer);
    ringPreviewTimer = null;
  }
  if (customRingAudio) {
    customRingAudio.pause();
    customRingAudio.currentTime = 0;
    customRingAudio = null;
  }
  if (customRingObjectUrl) {
    URL.revokeObjectURL(customRingObjectUrl);
    customRingObjectUrl = null;
  }
}

export function playUiSound(name, volumeScale = 1) {
  if (!soundsEnabled) return;

  const volume = volumeScale;

  if (soundPack === 'majestic') {
    tryPlayFile(name, volume).catch(() => {});
    return;
  }

  tryPlayFile(name, volume).then((played) => {
    if (!played) playProcedural(name, volume);
  });
}

export function bindGlobalUiClicks() {
  const onClick = (event) => {
    if (!soundsEnabled) return;

    const target = event.target.closest(
      'button, a[href], label.settings-switch, [role="button"]:not(.track-item)'
    );
    if (!target || target.disabled) return;
    if (target.dataset.uiSound === 'none') return;
    if (target.closest('.like-btn')) return;
    if (target.closest('.player')) return;
    if (target.closest('.track-item') && !target.closest('.track-menu-wrap, .track-menu-btn')) return;

    const custom = target.dataset.uiSound;
    if (custom) {
      playUiSound(custom);
      return;
    }

    playUiSound('click');
  };

  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
