// Device-wide preferences that are shared across accounts on this machine.
import { DEFAULT_KEYBINDS, normalizeKeybinds } from './keybinds';

const GLOBAL_KEYS = {
  appSettings: 'render_app_settings',
  player: 'render_player',
  playbackSession: 'render_playback_session',
  staticIdSeq: 'render_static_id_seq',
};

// Per-account data — namespaced by the logged-in user's id.
const SCOPED_BASE = {
  history: 'history',
  searchRecent: 'search_recent',
  liked: 'liked',
  playlists: 'playlists',
  profile: 'profile',
};

const LEGACY_SCOPED_KEYS = [
  'render_history',
  'render_search_recent',
  'render_liked',
  'render_playlists',
  'render_profile',
];

let storageNamespace = '';

export function setStorageNamespace(userId) {
  storageNamespace =
    userId !== null && userId !== undefined && `${userId}`.trim() !== '' ? `u${userId}` : '';
}

export function resetStorageNamespace() {
  storageNamespace = '';
}

function scopedKey(name) {
  const base = SCOPED_BASE[name];
  return storageNamespace ? `render_${storageNamespace}_${base}` : `render_${base}`;
}

/** One-time cleanup of the old shared (non-namespaced) data. */
export function clearLegacyGlobalData() {
  LEGACY_SCOPED_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  });
}

export function isValidStaticId(value) {
  return /^\d+$/.test(String(value ?? '').replace(/^#/, '').trim());
}

export function formatStaticId(value) {
  const normalized = String(value ?? '').replace(/^#/, '').trim();
  return normalized || '';
}

export function allocateStaticId() {
  const key = GLOBAL_KEYS.staticIdSeq;
  let next = Number(loadJson(key, 0)) || 0;
  next += 1;
  saveJson(key, next);
  return String(next);
}

const DEFAULT_PROFILE = {
  avatarUrl: '',
  bannerUrl: '',
  bannerPositionY: 50,
  bannerHeight: 160,
  bannerOverlay: 0,
  staticId: '',
  displayName: 'Render User',
  username: 'renderuser',
  bio: '',
  createdAt: null,
  links: [],
};

const DEFAULT_PLAYER_PREFS = {
  volume: 100,
  muted: false,
  shuffle: false,
  repeat: 'off',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreset: 'flat',
  normalizeLoudness: false,
};

export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60];
export const PLAYBACK_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const MAX_LIKED_TRACKS = 400;

export const ACCENT_PRESETS = [
  { id: 'violet', hue: 265 },
  { id: 'indigo', hue: 250 },
  { id: 'blue', hue: 220 },
  { id: 'cyan', hue: 190 },
  { id: 'teal', hue: 168 },
  { id: 'green', hue: 145 },
  { id: 'lime', hue: 95 },
  { id: 'amber', hue: 38 },
  { id: 'orange', hue: 24 },
  { id: 'rose', hue: 340 },
  { id: 'fuchsia', hue: 310 },
  { id: 'red', hue: 0 },
];

export const ACCENT_WHITE_PRESET = { id: 'white', neutral: true };

export const ACCENT_RGB_PRESET = { id: 'rgb', rgb: true };

export const THEME_PRESETS = [
  { id: 'dark', labelKey: 'theme_dark' },
  { id: 'midnight', labelKey: 'theme_midnight' },
  { id: 'oled', labelKey: 'theme_oled' },
  { id: 'dusk', labelKey: 'theme_dusk' },
  { id: 'ocean', labelKey: 'theme_ocean' },
  { id: 'forest', labelKey: 'theme_forest' },
  { id: 'light', labelKey: 'theme_light' },
  { id: 'paper', labelKey: 'theme_paper' },
];

export const DEFAULT_APP_SETTINGS = {
  accentHue: 265,
  accentRgb: false,
  accentNeutral: false,
  theme: 'dark',
  glassBlur: 16,
  animationsEnabled: true,
  compactDock: false,
  fontId: 'space-grotesk',
  uiRoundness: 14,
  interfaceScale: 1,
  autoplayNext: true,
  resumePlayback: true,
  crossfadeSeconds: 0,
  normalizeLoudness: false,
  historyLimit: 50,
  showAlbumColumn: true,
  compactUi: false,
  customBackgroundUrl: '',
  uiSoundsEnabled: true,
  uiSoundVolume: 35,
  uiSoundStyle: 'soft',
  uiSoundPack: 'builtin',
  keybinds: DEFAULT_KEYBINDS,
  uiShader: 'none',
  uiShaderIntensity: 0.45,
  uiGlowStrength: 0.35,
  playerBarStyle: 'pill',
  playerPlayStyle: 'solid',
  playerCoverMotion: 'none',
  playerCoverSize: 'md',
  playerCoverShape: 'rounded',
  playerAlign: 'spread',
  playerHeight: 'normal',
  showPlayerLikes: true,
  trackListStyle: 'comfortable',
  contentDensity: 'comfortable',
  accentStrength: 0.7,
  panelOpacity: 0.88,
  progressStyle: 'line',
  sidebarLabels: true,
  reduceTransparency: false,
  layoutStyle: 'floating',
  topBarStyle: 'floating',
  sidebarStyle: 'panel',
  cardStyle: 'elevated',
  homeLayout: 'comfortable',
  coverRadius: 14,
  motionLevel: 'full',
  waveNoExplicit: false,
  waveLikedOnly: false,
  waveNoRecentRepeats: false,
};


export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadHistory() {
  return loadJson(scopedKey('history'), []);
}

export function saveHistory(tracks) {
  saveJson(scopedKey('history'), tracks);
}

export function loadLiked() {
  return loadJson(scopedKey('liked'), []);
}

export function saveLiked(tracks) {
  const capped = Array.isArray(tracks) ? tracks.slice(0, MAX_LIKED_TRACKS) : [];
  saveJson(scopedKey('liked'), capped);
}

export function loadUserPlaylists() {
  return loadJson(scopedKey('playlists'), []);
}

export function saveUserPlaylists(playlists) {
  saveJson(scopedKey('playlists'), playlists);
}

export function addTrackToHistory(tracks, track, max = 50) {
  const filtered = tracks.filter((t) => t.id !== track.id);
  return [{ ...track, playedAt: Date.now() }, ...filtered].slice(0, max);
}

export function loadSearchRecent() {
  return loadJson(scopedKey('searchRecent'), []);
}

export function saveSearchRecent(tracks) {
  saveJson(scopedKey('searchRecent'), tracks);
}

export function addSearchRecentTracks(existing, tracks, max = 24) {
  const incoming = Array.isArray(tracks) ? tracks : [tracks];
  const merged = [...incoming, ...existing];
  const seen = new Set();
  const result = [];

  for (const track of merged) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
    if (result.length >= max) break;
  }

  return result;
}

export function mergeRecentTracks(history, searchRecent, limit = 24) {
  return addSearchRecentTracks([], [...history, ...searchRecent], limit);
}

export function toggleLikedTrack(liked, track) {
  const exists = liked.some((t) => t.id === track.id);
  if (exists) {
    return liked.filter((t) => t.id !== track.id);
  }
  return [track, ...liked].slice(0, MAX_LIKED_TRACKS);
}

export function isTrackLiked(liked, trackId) {
  return liked.some((t) => t.id === trackId);
}

export function loadProfile() {
  const stored = loadJson(scopedKey('profile'), DEFAULT_PROFILE);
  const profile = { ...DEFAULT_PROFILE, ...stored };

  if (!profile.createdAt) {
    profile.createdAt = Date.now();
  }

  if (!profile.displayName?.trim()) {
    profile.displayName = DEFAULT_PROFILE.displayName;
  }

  if (!profile.username?.trim()) {
    profile.username = DEFAULT_PROFILE.username;
  }

  if (!isValidStaticId(profile.staticId)) {
    profile.staticId = allocateStaticId();
  } else {
    profile.staticId = formatStaticId(profile.staticId);
  }

  const bannerY = Number(profile.bannerPositionY);
  profile.bannerPositionY = Number.isFinite(bannerY)
    ? Math.min(100, Math.max(0, bannerY))
    : DEFAULT_PROFILE.bannerPositionY;

  const bannerHeight = Number(profile.bannerHeight);
  profile.bannerHeight = Number.isFinite(bannerHeight)
    ? Math.min(320, Math.max(140, bannerHeight))
    : DEFAULT_PROFILE.bannerHeight;

  const bannerOverlay = Number(profile.bannerOverlay);
  profile.bannerOverlay = Number.isFinite(bannerOverlay)
    ? Math.min(80, Math.max(0, bannerOverlay))
    : DEFAULT_PROFILE.bannerOverlay;

  return profile;
}

export function saveProfile(profile) {
  saveJson(scopedKey('profile'), profile);
}

/** Fresh profile for a brand-new account (no static id allocated locally). */
export function getDefaultProfile() {
  return { ...DEFAULT_PROFILE, createdAt: Date.now() };
}

export function loadAppSettings() {
  const stored = loadJson(GLOBAL_KEYS.appSettings, DEFAULT_APP_SETTINGS);
  const settings = { ...DEFAULT_APP_SETTINGS, ...stored };

  const blur = Number(settings.glassBlur);
  settings.glassBlur = Number.isFinite(blur)
    ? Math.min(28, Math.max(8, blur))
    : DEFAULT_APP_SETTINGS.glassBlur;

  const hue = Number(settings.accentHue);
  settings.accentHue = Number.isFinite(hue) ? hue : DEFAULT_APP_SETTINGS.accentHue;

  if (typeof settings.accentRgb !== 'boolean') {
    settings.accentRgb = DEFAULT_APP_SETTINGS.accentRgb;
  }

  if (typeof settings.accentNeutral !== 'boolean') {
    settings.accentNeutral = DEFAULT_APP_SETTINGS.accentNeutral;
  }

  if (!THEME_PRESETS.some((theme) => theme.id === settings.theme)) {
    settings.theme = DEFAULT_APP_SETTINGS.theme;
  }

  if (typeof settings.animationsEnabled !== 'boolean') {
    settings.animationsEnabled = DEFAULT_APP_SETTINGS.animationsEnabled;
  }

  if (typeof settings.compactDock !== 'boolean') {
    settings.compactDock = DEFAULT_APP_SETTINGS.compactDock;
  }

  const roundness = Number(settings.uiRoundness);
  settings.uiRoundness = Number.isFinite(roundness)
    ? Math.min(24, Math.max(8, roundness))
    : DEFAULT_APP_SETTINGS.uiRoundness;

  const scale = Number(settings.interfaceScale);
  settings.interfaceScale = Number.isFinite(scale)
    ? Math.min(1.12, Math.max(0.88, scale))
    : DEFAULT_APP_SETTINGS.interfaceScale;

  if (typeof settings.autoplayNext !== 'boolean') {
    settings.autoplayNext = DEFAULT_APP_SETTINGS.autoplayNext;
  }

  if (typeof settings.resumePlayback !== 'boolean') {
    settings.resumePlayback = DEFAULT_APP_SETTINGS.resumePlayback;
  }

  if (typeof settings.waveNoExplicit !== 'boolean') {
    settings.waveNoExplicit = DEFAULT_APP_SETTINGS.waveNoExplicit;
  }
  if (typeof settings.waveLikedOnly !== 'boolean') {
    settings.waveLikedOnly = DEFAULT_APP_SETTINGS.waveLikedOnly;
  }
  if (typeof settings.waveNoRecentRepeats !== 'boolean') {
    settings.waveNoRecentRepeats = DEFAULT_APP_SETTINGS.waveNoRecentRepeats;
  }

  const crossfade = Number(settings.crossfadeSeconds);
  settings.crossfadeSeconds = Number.isFinite(crossfade)
    ? Math.min(8, Math.max(0, Math.round(crossfade)))
    : DEFAULT_APP_SETTINGS.crossfadeSeconds;

  if (typeof settings.normalizeLoudness !== 'boolean') {
    const prefs = loadJson(GLOBAL_KEYS.player, DEFAULT_PLAYER_PREFS);
    settings.normalizeLoudness = Boolean(prefs?.normalizeLoudness);
  }

  const historyLimit = Number(settings.historyLimit);
  settings.historyLimit = [25, 50, 100, 200].includes(historyLimit)
    ? historyLimit
    : DEFAULT_APP_SETTINGS.historyLimit;

  if (typeof settings.showAlbumColumn !== 'boolean') {
    settings.showAlbumColumn = DEFAULT_APP_SETTINGS.showAlbumColumn;
  }

  if (typeof settings.compactUi !== 'boolean') {
    settings.compactUi = Boolean(settings.compactDock || settings.denseTrackList);
  }

  const validFonts = ['inter', 'space-grotesk', 'outfit', 'sora', 'unbounded', 'playfair', 'jetbrains', 'manrope', 'dm-sans'];
  if (!validFonts.includes(settings.fontId)) {
    settings.fontId = DEFAULT_APP_SETTINGS.fontId;
  }

  if (typeof settings.uiSoundsEnabled !== 'boolean') {
    settings.uiSoundsEnabled = DEFAULT_APP_SETTINGS.uiSoundsEnabled;
  }

  const uiVol = Number(settings.uiSoundVolume);
  settings.uiSoundVolume = Number.isFinite(uiVol)
    ? Math.min(100, Math.max(0, uiVol))
    : DEFAULT_APP_SETTINGS.uiSoundVolume;

  const validSoundPacks = ['builtin', 'majestic'];
  if (!validSoundPacks.includes(settings.uiSoundPack)) {
    settings.uiSoundPack = DEFAULT_APP_SETTINGS.uiSoundPack;
  }

  const validBuiltinStyles = ['soft', 'crisp', 'warm', 'minimal'];
  const validMajesticStyles = ['confirm', 'warning', 'message', 'hover'];
  const validSoundStyles =
    settings.uiSoundPack === 'majestic' ? validMajesticStyles : validBuiltinStyles;

  if (!validSoundStyles.includes(settings.uiSoundStyle)) {
    settings.uiSoundStyle =
      settings.uiSoundPack === 'majestic' ? validMajesticStyles[0] : DEFAULT_APP_SETTINGS.uiSoundStyle;
  }

  settings.keybinds = normalizeKeybinds(settings.keybinds);

  const legacyWeatherMap = {
    aurora: 'snow',
    mesh: 'leaves',
    noise: 'rain',
    grid: 'grass',
  };
  const validWeather = ['none', 'snow', 'leaves', 'rain', 'grass', 'all'];
  const storedWeather = legacyWeatherMap[settings.uiShader] || settings.uiShader;
  settings.uiShader = validWeather.includes(storedWeather)
    ? storedWeather
    : DEFAULT_APP_SETTINGS.uiShader;

  const shaderIntensity = Number(settings.uiShaderIntensity);
  settings.uiShaderIntensity = Number.isFinite(shaderIntensity)
    ? Math.min(1, Math.max(0, shaderIntensity))
    : DEFAULT_APP_SETTINGS.uiShaderIntensity;

  const glowStrength = Number(settings.uiGlowStrength);
  settings.uiGlowStrength = Number.isFinite(glowStrength)
    ? Math.min(1, Math.max(0, glowStrength))
    : DEFAULT_APP_SETTINGS.uiGlowStrength;

  if (!['pill', 'wide'].includes(settings.playerBarStyle)) {
    settings.playerBarStyle = DEFAULT_APP_SETTINGS.playerBarStyle;
  }
  if (!['solid', 'accent', 'soft'].includes(settings.playerPlayStyle)) {
    settings.playerPlayStyle = DEFAULT_APP_SETTINGS.playerPlayStyle;
  }
  if (!['none', 'lift', 'spin'].includes(settings.playerCoverMotion)) {
    settings.playerCoverMotion = DEFAULT_APP_SETTINGS.playerCoverMotion;
  }

  if (!['sm', 'md', 'lg'].includes(settings.playerCoverSize)) {
    settings.playerCoverSize = DEFAULT_APP_SETTINGS.playerCoverSize;
  }

  if (!['rounded', 'square', 'circle'].includes(settings.playerCoverShape)) {
    settings.playerCoverShape = DEFAULT_APP_SETTINGS.playerCoverShape;
  }

  if (!['left', 'center', 'spread'].includes(settings.playerAlign)) {
    settings.playerAlign = DEFAULT_APP_SETTINGS.playerAlign;
  }

  if (!['compact', 'normal', 'tall'].includes(settings.playerHeight)) {
    settings.playerHeight = DEFAULT_APP_SETTINGS.playerHeight;
  }

  if (typeof settings.showPlayerLikes !== 'boolean') {
    settings.showPlayerLikes = DEFAULT_APP_SETTINGS.showPlayerLikes;
  }

  if (!['comfortable', 'compact', 'dense'].includes(settings.trackListStyle)) {
    settings.trackListStyle = DEFAULT_APP_SETTINGS.trackListStyle;
  }

  if (!['comfortable', 'compact', 'dense'].includes(settings.contentDensity)) {
    settings.contentDensity = DEFAULT_APP_SETTINGS.contentDensity;
  }

  const accentStrength = Number(settings.accentStrength);
  settings.accentStrength = Number.isFinite(accentStrength)
    ? Math.min(1, Math.max(0.35, accentStrength))
    : DEFAULT_APP_SETTINGS.accentStrength;

  const panelOpacity = Number(settings.panelOpacity);
  settings.panelOpacity = Number.isFinite(panelOpacity)
    ? Math.min(1, Math.max(0.55, panelOpacity))
    : DEFAULT_APP_SETTINGS.panelOpacity;

  if (!['line', 'bold', 'dot'].includes(settings.progressStyle)) {
    settings.progressStyle = DEFAULT_APP_SETTINGS.progressStyle;
  }

  if (typeof settings.sidebarLabels !== 'boolean') {
    settings.sidebarLabels = DEFAULT_APP_SETTINGS.sidebarLabels;
  }

  if (typeof settings.reduceTransparency !== 'boolean') {
    settings.reduceTransparency = DEFAULT_APP_SETTINGS.reduceTransparency;
  }

  if (!['solid', 'floating', 'inset'].includes(settings.layoutStyle)) {
    settings.layoutStyle = DEFAULT_APP_SETTINGS.layoutStyle;
  }

  if (!['solid', 'transparent', 'floating'].includes(settings.topBarStyle)) {
    settings.topBarStyle = DEFAULT_APP_SETTINGS.topBarStyle;
  }

  if (!['panel', 'rail', 'minimal'].includes(settings.sidebarStyle)) {
    settings.sidebarStyle = DEFAULT_APP_SETTINGS.sidebarStyle;
  }

  if (!['flat', 'elevated', 'outline'].includes(settings.cardStyle)) {
    settings.cardStyle = DEFAULT_APP_SETTINGS.cardStyle;
  }

  if (!['comfortable', 'magazine', 'compact'].includes(settings.homeLayout)) {
    settings.homeLayout = DEFAULT_APP_SETTINGS.homeLayout;
  }

  const coverRadius = Number(settings.coverRadius);
  settings.coverRadius = Number.isFinite(coverRadius)
    ? Math.min(28, Math.max(8, Math.round(coverRadius)))
    : DEFAULT_APP_SETTINGS.coverRadius;

  if (!['full', 'reduced', 'off'].includes(settings.motionLevel)) {
    settings.motionLevel = DEFAULT_APP_SETTINGS.motionLevel;
  }

  return settings;
}

export function saveAppSettings(settings) {
  saveJson(GLOBAL_KEYS.appSettings, settings);
}

export function loadPlayerPrefs() {
  const stored = loadJson(GLOBAL_KEYS.player, DEFAULT_PLAYER_PREFS);
  const volume = Number(stored.volume);
  const repeat = ['off', 'all', 'one'].includes(stored.repeat) ? stored.repeat : DEFAULT_PLAYER_PREFS.repeat;
  const eqGains = Array.isArray(stored.eqGains)
    ? stored.eqGains.map((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(12, Math.max(-12, n)) : 0;
    })
    : DEFAULT_PLAYER_PREFS.eqGains;
  while (eqGains.length < 10) eqGains.push(0);
  return {
    volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_PLAYER_PREFS.volume,
    muted: Boolean(stored.muted),
    shuffle: Boolean(stored.shuffle),
    repeat,
    eqGains: eqGains.slice(0, 10),
    eqPreset: typeof stored.eqPreset === 'string' ? stored.eqPreset : DEFAULT_PLAYER_PREFS.eqPreset,
    normalizeLoudness: Boolean(stored.normalizeLoudness),
  };
}

export function savePlayerPrefs(prefs) {
  const current = loadJson(GLOBAL_KEYS.player, DEFAULT_PLAYER_PREFS);
  saveJson(GLOBAL_KEYS.player, { ...current, ...prefs });
}

function slimSessionTrack(track) {
  if (!track?.id) return null;
  return {
    id: track.id,
    title: track.title || '',
    artist: track.artist || '',
    artistId: track.artistId || null,
    album: track.album || '',
    duration: Number(track.duration) || 0,
    cover: track.cover || '',
    coverThumb: track.coverThumb || '',
    soundcloudUrl: track.soundcloudUrl || track.url || '',
  };
}

export function savePlaybackSession(session) {
  const track = slimSessionTrack(session?.track);
  if (!track) {
    clearPlaybackSession();
    return;
  }

  const queue = (Array.isArray(session.queue) ? session.queue : [])
    .map(slimSessionTrack)
    .filter(Boolean)
    .slice(0, 80);

  const userQueue = (Array.isArray(session.userQueue) ? session.userQueue : [])
    .map(slimSessionTrack)
    .filter(Boolean)
    .slice(0, 40);

  saveJson(GLOBAL_KEYS.playbackSession, {
    track,
    queue: queue.length ? queue : [track],
    userQueue,
    playlistId: session.playlistId || null,
    waveActive: Boolean(session.waveActive),
    position: Math.max(0, Number(session.position) || 0),
    savedAt: Date.now(),
  });
}

export function loadPlaybackSession() {
  const stored = loadJson(GLOBAL_KEYS.playbackSession, null);
  if (!stored?.track?.id) return null;
  const savedAt = Number(stored.savedAt) || 0;
  if (savedAt && Date.now() - savedAt > PLAYBACK_SESSION_MAX_AGE_MS) {
    clearPlaybackSession();
    return null;
  }
  return stored;
}

export function clearPlaybackSession() {
  try {
    localStorage.removeItem(GLOBAL_KEYS.playbackSession);
  } catch {
    // ignore
  }
}

export function adjustStoredVolume(delta) {
  const prefs = loadPlayerPrefs();
  const current = prefs.volume;
  const next = Math.min(100, Math.max(0, current + delta));
  savePlayerPrefs({
    volume: next > 0 ? next : prefs.volume || 100,
    muted: next === 0 ? prefs.muted : false,
  });
  return next;
}

export function toggleStoredMute() {
  const prefs = loadPlayerPrefs();
  if (prefs.muted) {
    savePlayerPrefs({ volume: prefs.volume || 100, muted: false });
    return false;
  }
  savePlayerPrefs({ volume: prefs.volume || 100, muted: true });
  return true;
}

export function createPlaylist({ name, description = '', cover = '', tracks = [], source = 'user' }) {
  return {
    id: `user-${Date.now()}`,
    name,
    description,
    cover: cover || 'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg',
    tracks: Array.isArray(tracks) ? tracks : [],
    isUser: true,
    source,
    createdAt: Date.now(),
  };
}

