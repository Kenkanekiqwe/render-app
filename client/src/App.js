import React, { useState, useEffect, useCallback, useRef } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import './App.css';
import { LanguageProvider } from './context/LanguageContext';
import PlaybackExtrasContext from './context/PlaybackExtrasContext';
import TitleBar from './components/TitleBar';
import TopBar from './components/TopBar';
import MainContent from './components/MainContent';
import ArtistView from './components/ArtistView';
import Profile from './components/Profile';
import Settings from './components/Settings';
import Friends from './components/Friends';
import VoiceCall from './components/VoiceCall';
import { CallProvider } from './context/CallContext';
import GlobalChat from './components/GlobalChat';
import UserProfile from './components/UserProfile';
import Marketplace from './components/Marketplace';
import AdminPanel from './components/AdminPanel';
import Player from './components/Player';
import AuthScreen from './components/AuthScreen';
import BootSplash from './components/BootSplash';
import axios from 'axios';
import { initDiscordPresence, updateDiscordPresence, presenceFromTrack } from './utils/discordPresence';
import {
  getToken,
  getStoredUser,
  applyAuthHeader,
  fetchMe,
  fetchAccountState,
  syncAccountState,
  uploadAccountBackground,
  clearSession,
  setSession,
  updateProfile,
  updatePrivacy,
  fetchMyPlaylists,
  syncPlaylists,
  fetchFriendPlaylist,
  syncNowPlaying,
} from './utils/auth';
import { buildWaveQueue, fetchRemoteWave, mergeWaveQueues, applyWaveFilters } from './utils/wave';
import { filterValidTracks } from './utils/tracks';
import { cachedRequest, prefetchRequest, clearApiCache } from './utils/apiCache';
import { getFontPreset, loadGoogleFont } from './utils/fonts';
import { isDesktopApp, isLowPowerMode, listenAppActive } from './utils/tauri';
import {
  isMiniPlayerWindow,
  publishMiniPlayerState,
  listenMiniPlayerAction,
  openMiniPlayerWindow,
  closeMiniPlayerWindow,
  hideMainWindow,
  showMainWindow,
} from './utils/miniPlayer';
import { MiniPlayerOverlay, MiniPlayerWindow } from './components/MiniPlayer';
import {
  loadHistory,
  saveHistory,
  loadSearchRecent,
  saveSearchRecent,
  addSearchRecentTracks,
  loadLiked,
  saveLiked,
  loadUserPlaylists,
  saveUserPlaylists,
  loadProfile,
  getDefaultProfile,
  setStorageNamespace,
  resetStorageNamespace,
  clearLegacyGlobalData,
  loadAppSettings,
  saveAppSettings,
  THEME_PRESETS,
  addTrackToHistory,
  toggleLikedTrack,
  isTrackLiked,
  createPlaylist,
  adjustStoredVolume,
  toggleStoredMute,
  loadPlayerPrefs,
  savePlayerPrefs,
  loadPlaybackSession,
  savePlaybackSession,
  clearPlaybackSession,
} from './utils/storage';
import {
  profileFromUser,
  buildProfilePayload,
  profileNeedsServerSync,
  buildMigrationPayload,
  privacyFromUser,
  slimTrackForProfile,
} from './utils/profile';
import { setUiSoundConfig, playUiSound, bindGlobalUiClicks } from './utils/uiSounds';
import {
  matchesKeybind,
  isEditableTarget,
} from './utils/keybinds';
import { syncGlobalKeybinds, listenGlobalKeybinds } from './utils/globalKeybinds';

function isAccountGlobalStorageKey(key) {
  return key.startsWith('render_')
    && !/^render_u\d+_/.test(key)
    && !['render_auth_token', 'render_auth_user', 'render_static_id_seq'].includes(key);
}

function AppContent() {
  useEffect(() => {
    if (!isDesktopApp()) return undefined;
    let cancelled = false;

    const checkForDesktopUpdate = async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;

        const skippedVersion = localStorage.getItem('render_update_skipped_version');
        if (skippedVersion === update.version) return;

        const notes = typeof update.body === 'string' && update.body.trim()
          ? `\n\nЧто нового:\n${update.body.trim()}`
          : '';
        const accepted = window.confirm(
          `Доступно обновление Render ${update.version}.${notes}\n\nУстановить обновление сейчас?`
        );

        if (!accepted) {
          localStorage.setItem('render_update_skipped_version', update.version);
          return;
        }

        await update.downloadAndInstall();
        if (!cancelled) await relaunch();
      } catch (error) {
        // Missing release metadata or a network error must not block music playback.
        console.warn('[updater] Update check failed:', error);
      }
    };

    const initialTimer = window.setTimeout(checkForDesktopUpdate, 8000);
    const interval = window.setInterval(checkForDesktopUpdate, 6 * 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  const [tracks, setTracks] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchArtistResults, setSearchArtistResults] = useState([]);
  const [searchRecent, setSearchRecent] = useState([]);
  const [apiPlaylists, setApiPlaylists] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [history, setHistory] = useState([]);
  const [likedTracks, setLikedTracks] = useState([]);
  const [profile, setProfile] = useState(() => getDefaultProfile());
  const [appSettings, setAppSettings] = useState(() => loadAppSettings());
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [authChecked, setAuthChecked] = useState(() => !getToken());
  const [accountReady, setAccountReady] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [resumeSession, setResumeSession] = useState(null);
  const [sleepEndsAt, setSleepEndsAt] = useState(null);
  const [miniMode, setMiniMode] = useState(false);
  const [miniWindowOpen, setMiniWindowOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentView, setCurrentView] = useState('home');
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [activeArtistId, setActiveArtistId] = useState(null);
  const [viewUserId, setViewUserId] = useState(null);
  const [externalPlaylist, setExternalPlaylist] = useState(null);
  const [externalPlaylistOwner, setExternalPlaylistOwner] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [waveActive, setWaveActive] = useState(false);
  const [userQueue, setUserQueue] = useState([]);
  const [playbackPlaylistId, setPlaybackPlaylistId] = useState(null);
  const initialPlayerPrefs = loadPlayerPrefs();
  const [shuffleEnabled, setShuffleEnabled] = useState(initialPlayerPrefs.shuffle);
  const [repeatMode, setRepeatMode] = useState(initialPlayerPrefs.repeat);
  const searchTimeoutRef = useRef(null);
  const playbackProgressRef = useRef({ position: 0, duration: 0 });
  const discordSyncRef = useRef(null);
  const currentViewRef = useRef(currentView);
  const waveQueueRef = useRef([]);
  const playlistSyncTimerRef = useRef(null);
  const historySaveTimerRef = useRef(null);
  const likedSaveTimerRef = useRef(null);
  const waveActiveRef = useRef(false);
  const playbackQueueRef = useRef([]);
  const userQueueRef = useRef([]);
  const contextTrackIdRef = useRef(null);
  const shuffledQueueRef = useRef(null);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  const repeatModeRef = useRef(repeatMode);
  const appSettingsRef = useRef(appSettings);
  const playerRef = useRef(null);
  const currentTrackRef = useRef(null);
  const isPlayingRef = useRef(false);
  const miniModeRef = useRef(false);
  const playbackPlaylistIdRef = useRef(null);
  const resumeRestoredRef = useRef(false);
  const resumeSessionRef = useRef(null);
  const tracksLoadedRef = useRef(false);
  const artistResolveCacheRef = useRef(new Map());

  useEffect(() => {
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    miniModeRef.current = miniMode;
  }, [miniMode]);

  useEffect(() => {
    playbackPlaylistIdRef.current = playbackPlaylistId;
  }, [playbackPlaylistId]);

  useEffect(() => {
    resumeSessionRef.current = resumeSession;
  }, [resumeSession]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
  }, [shuffleEnabled]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  const getBaseQueue = useCallback(() => (
    waveActiveRef.current ? waveQueueRef.current : playbackQueueRef.current
  ), []);

  const rebuildShuffledQueue = useCallback(() => {
    const base = getBaseQueue();
    if (!base.length) {
      shuffledQueueRef.current = null;
      return;
    }
    const current = currentTrackRef.current;
    const rest = base.filter((track) => track.id !== current?.id);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    shuffledQueueRef.current = current ? [current, ...rest] : [...rest];
  }, [getBaseQueue]);

  const getActiveQueue = useCallback(() => {
    if (shuffleEnabledRef.current && shuffledQueueRef.current?.length) {
      return shuffledQueueRef.current;
    }
    return getBaseQueue();
  }, [getBaseQueue]);

  const setUserQueueBoth = useCallback((next) => {
    const value = typeof next === 'function' ? next(userQueueRef.current) : next;
    userQueueRef.current = value;
    setUserQueue(value);
  }, []);

  const addToQueue = useCallback((track) => {
    if (!track?.id) return;
    setUserQueueBoth((prev) => (
      prev.some((item) => item.id === track.id) ? prev : [...prev, track]
    ));
  }, [setUserQueueBoth]);

  const playNextInQueue = useCallback((track) => {
    if (!track?.id) return;
    setUserQueueBoth((prev) => [track, ...prev.filter((item) => item.id !== track.id)]);
  }, [setUserQueueBoth]);

  const removeFromQueue = useCallback((trackId) => {
    setUserQueueBoth((prev) => prev.filter((item) => item.id !== trackId));
  }, [setUserQueueBoth]);

  const clearQueue = useCallback(() => {
    setUserQueueBoth([]);
  }, [setUserQueueBoth]);

  const moveInQueue = useCallback((index, direction) => {
    setUserQueueBoth((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, [setUserQueueBoth]);

  const takeNextFromUserQueue = useCallback(() => {
    const [next, ...rest] = userQueueRef.current;
    if (!next) return false;
    userQueueRef.current = rest;
    setUserQueue(rest);
    setCurrentTrack(next);
    setIsPlaying(true);
    setHistory((prev) => addTrackToHistory(prev, next, appSettingsRef.current.historyLimit));
    return true;
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const next = !prev;
      if (next) rebuildShuffledQueue();
      else shuffledQueueRef.current = null;
      savePlayerPrefs({ ...loadPlayerPrefs(), shuffle: next });
      return next;
    });
  }, [rebuildShuffledQueue]);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      const order = ['off', 'all', 'one'];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      savePlayerPrefs({ ...loadPlayerPrefs(), repeat: next });
      return next;
    });
  }, []);

  const openEqualizer = useCallback(() => {
    playerRef.current?.openEqualizer?.();
  }, []);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    if (!accountReady) return undefined;
    if (historySaveTimerRef.current) clearTimeout(historySaveTimerRef.current);
    historySaveTimerRef.current = setTimeout(() => saveHistory(history), 1500);
    return () => {
      if (historySaveTimerRef.current) clearTimeout(historySaveTimerRef.current);
    };
  }, [history, accountReady]);

  useEffect(() => {
    if (!accountReady) return undefined;
    if (likedSaveTimerRef.current) clearTimeout(likedSaveTimerRef.current);
    likedSaveTimerRef.current = setTimeout(() => saveLiked(likedTracks), 1500);
    return () => {
      if (likedSaveTimerRef.current) clearTimeout(likedSaveTimerRef.current);
    };
  }, [likedTracks, accountReady]);

  useEffect(() => {
    if (!accountReady) return undefined;
    saveUserPlaylists(userPlaylists);
    if (playlistSyncTimerRef.current) clearTimeout(playlistSyncTimerRef.current);
    playlistSyncTimerRef.current = setTimeout(() => {
      syncPlaylists(userPlaylists).catch((error) => {
        console.error('Playlist sync failed:', error);
      });
    }, 2000);
    return () => {
      if (playlistSyncTimerRef.current) clearTimeout(playlistSyncTimerRef.current);
    };
  }, [userPlaylists, accountReady]);

  const applyUserToState = useCallback((user) => {
    setProfile((prev) => {
      const next = profileFromUser(user);
      if (!Array.isArray(user?.links) && Array.isArray(prev.links) && prev.links.length) {
        next.links = prev.links;
      }
      return next;
    });
    setAppSettings((prev) => ({
      ...prev,
      customBackgroundUrl: user.backgroundUrl || '',
    }));
  }, []);

  // Profile cosmetics live in MariaDB — load from server, migrate legacy local data once.
  const bootstrapAccount = useCallback(async (user) => {
    if (!user) return;
    setStorageNamespace(user.id);

    // The server snapshot is authoritative once an account has been synced.
    // Restore it before loading React state so settings and libraries appear on
    // every browser/device after sign-in.
    let remoteAccountState = null;
    try {
      remoteAccountState = await fetchAccountState();
    } catch (error) {
      console.error('Account data load failed; using local cache:', error);
    }
    const remoteStorage = remoteAccountState?.localStorage;
    if (remoteStorage && typeof remoteStorage === 'object') {
      const scopedPrefix = `render_u${user.id}_`;
      try {
        const existingKeys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && (key.startsWith(scopedPrefix) || isAccountGlobalStorageKey(key))) existingKeys.push(key);
        }
        existingKeys.forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(remoteStorage, key)) localStorage.removeItem(key);
        });
        Object.entries(remoteStorage).forEach(([key, value]) => {
          if (typeof value === 'string') localStorage.setItem(key, value);
        });
      } catch (error) {
        console.error('Account data restore failed:', error);
      }
    }

    const storedSettings = loadAppSettings();
    setAppSettings(storedSettings);
    applyUserToState(user);
    setHistory(loadHistory());
    setLikedTracks(loadLiked());
    setSearchRecent(loadSearchRecent());

    const localPlaylists = loadUserPlaylists();
    try {
      const serverPlaylists = await fetchMyPlaylists();
      if (serverPlaylists.length > 0) {
        setUserPlaylists(serverPlaylists);
      } else if (localPlaylists.length > 0) {
        setUserPlaylists(localPlaylists);
        const synced = await syncPlaylists(localPlaylists);
        setUserPlaylists(synced);
      } else {
        setUserPlaylists([]);
      }
    } catch (error) {
      console.error('Playlist load failed:', error);
      setUserPlaylists(localPlaylists);
    }

    const localProfile = loadProfile();
    const migrationPayload = buildMigrationPayload(
      user,
      localProfile,
      storedSettings.customBackgroundUrl || ''
    );

    if (profileNeedsServerSync(user, migrationPayload)) {
      try {
        const synced = await updateProfile(migrationPayload);
        setAuthUser(synced);
        applyUserToState(synced);
      } catch (error) {
        console.error('Profile migration sync failed:', error);
      }
    }

    setAccountReady(true);
  }, [applyUserToState]);

  const syncProfileToServer = useCallback(
    async (updates = {}) => {
      const nextProfile = { ...profile, ...updates };
      const backgroundUrl =
        updates.backgroundUrl !== undefined
          ? updates.backgroundUrl
          : appSettings.customBackgroundUrl || '';
      const payload = {
        ...buildProfilePayload(nextProfile, backgroundUrl),
        ...(Object.prototype.hasOwnProperty.call(updates, 'pinnedTrack')
          ? { pinnedTrack: updates.pinnedTrack }
          : {}),
      };

      if (!Object.prototype.hasOwnProperty.call(updates, 'links')) {
        delete payload.links;
      }

      if (updates.username != null) {
        payload.username = String(updates.username).replace(/^@/, '').trim();
      }

      try {
        const user = await updateProfile(payload);
        setAuthUser(user);
        applyUserToState(user);
        return user;
      } catch (error) {
        console.error('Profile sync failed:', error);
        return null;
      }
    },
    [profile, appSettings.customBackgroundUrl, applyUserToState]
  );

  const handlePinTrack = useCallback(
    async (track) => {
      await syncProfileToServer({ pinnedTrack: track });
    },
    [syncProfileToServer]
  );

  const handleUnpinTrack = useCallback(async () => {
    await syncProfileToServer({ pinnedTrack: null });
  }, [syncProfileToServer]);

  const syncPrivacyToServer = useCallback(async (updates) => {
    try {
      const user = await updatePrivacy(updates);
      setAuthUser(user);
      return user;
    } catch (error) {
      console.error('Privacy sync failed:', error);
      return null;
    }
  }, []);

  const handlePrivacyChange = useCallback(
    async (updates) => {
      await syncPrivacyToServer(updates);
    },
    [syncPrivacyToServer]
  );

  const openUserProfile = useCallback((userId) => {
    if (!userId) return;
    setViewUserId(userId);
    setCurrentView('user-profile');
    setProfileEditing(false);
  }, []);

  const handleWorkshopApply = useCallback(
    async (item) => {
      if (!item?.type || !item?.url) return;

      if (item.type === 'background') {
        await syncProfileToServer({ backgroundUrl: item.url });
        return;
      }

      if (item.type === 'banner') {
        await syncProfileToServer({ bannerUrl: item.url });
        return;
      }

      if (item.type === 'avatar') {
        await syncProfileToServer({ avatarUrl: item.url });
      }
    },
    [syncProfileToServer]
  );

  const handleMarketplaceBalanceChange = useCallback((renderCoins) => {
    setAuthUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, renderCoins };
      setSession(getToken(), next);
      return next;
    });
  }, []);

  const handleMarketplaceCosmeticsChange = useCallback((equippedCosmetics) => {
    setAuthUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, equippedCosmetics };
      setSession(getToken(), next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Remove the old shared data once so accounts start clean.
    clearLegacyGlobalData();
    applyAuthHeader();
    if (!getToken()) {
      setAuthChecked(true);
      return;
    }
    let cancelled = false;
    fetchMe()
      .then(async (user) => {
        if (cancelled) return;
        setAuthUser(user);
        await bootstrapAccount(user);
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setAuthUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrapAccount]);

  const handleAuthenticated = useCallback(
    async (user) => {
      setAuthUser(user);
      setAuthChecked(true);
      try {
        await bootstrapAccount(user);
      } catch (error) {
        console.error('Account bootstrap failed:', error);
        setAccountReady(true);
      }
    },
    [bootstrapAccount]
  );

  const handleLogout = useCallback(() => {
    clearSession();
    clearApiCache();
    resetStorageNamespace();
    setAccountReady(false);
    setAuthUser(null);
    setHistory([]);
    setLikedTracks([]);
    setUserPlaylists([]);
    setSearchRecent([]);
    setExternalPlaylist(null);
    setExternalPlaylistOwner('');
    setProfile(getDefaultProfile());
    setAppSettings((prev) => ({ ...prev, customBackgroundUrl: '' }));
    setCurrentTrack(null);
    setIsPlaying(false);
    setSleepEndsAt(null);
    setResumeSession(null);
    resumeRestoredRef.current = false;
    setCurrentView('home');
  }, []);

  useEffect(() => {
    if (!accountReady) return;
    saveSearchRecent(searchRecent);
  }, [searchRecent, accountReady]);

  // Also capture preferences written by independent components (for example
  // microphone/screen-share controls) that do not update App-level React state.
  useEffect(() => {
    if (!accountReady || !authUser?.id) return undefined;
    const persistSnapshot = () => {
      try {
        const prefix = `render_u${authUser.id}_`;
        const localStorageSnapshot = {};
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && (key.startsWith(prefix) || isAccountGlobalStorageKey(key))) {
            localStorageSnapshot[key] = localStorage.getItem(key) || '';
          }
        }
        syncAccountState({ localStorage: localStorageSnapshot }).catch((error) => {
          console.error('Periodic account data sync failed:', error);
        });
      } catch (error) {
        console.error('Could not collect periodic account data:', error);
      }
    };
    const timer = window.setInterval(persistSnapshot, 20000);
    return () => window.clearInterval(timer);
  }, [accountReady, authUser?.id]);

  // Debounced cloud backup for all account-scoped localStorage data and the
  // app/player preferences. This includes data added by newer client features
  // as long as it uses the account namespace.
  useEffect(() => {
    if (!accountReady || !authUser?.id) return undefined;
    const timer = window.setTimeout(() => {
      try {
        const prefix = `render_u${authUser.id}_`;
        const localStorageSnapshot = {};
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && (key.startsWith(prefix) || isAccountGlobalStorageKey(key))) {
            localStorageSnapshot[key] = localStorage.getItem(key) || '';
          }
        }
        syncAccountState({ localStorage: localStorageSnapshot }).catch((error) => {
          console.error('Account data sync failed:', error);
        });
      } catch (error) {
        console.error('Could not collect account data:', error);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [
    accountReady, authUser?.id, appSettings, profile, history, likedTracks,
    searchRecent, userPlaylists, currentTrack, userQueue, isPlaying,
    shuffleEnabled, repeatMode, playbackPlaylistId,
  ]);

  useEffect(() => {
    const { customBackgroundUrl, ...persisted } = appSettings;
    saveAppSettings(persisted);
    savePlayerPrefs({ normalizeLoudness: Boolean(appSettings.normalizeLoudness) });
  }, [appSettings]);

  const persistPlaybackSession = useCallback(() => {
    if (!appSettingsRef.current.resumePlayback || resumeSessionRef.current) return;
    const track = currentTrackRef.current;
    if (!track) return;
    const queue = waveActiveRef.current ? waveQueueRef.current : playbackQueueRef.current;
    savePlaybackSession({
      track,
      queue,
      userQueue: userQueueRef.current,
      playlistId: playbackPlaylistIdRef.current,
      waveActive: Boolean(waveActiveRef.current),
      position: playbackProgressRef.current.position || 0,
    });
  }, []);

  useEffect(() => {
    if (!accountReady) {
      resumeRestoredRef.current = false;
    }
  }, [accountReady]);

  useEffect(() => {
    if (!accountReady || resumeRestoredRef.current) return;
    resumeRestoredRef.current = true;
    if (!appSettingsRef.current.resumePlayback) return;

    const session = loadPlaybackSession();
    if (!session?.track?.id) return;

    const queue = Array.isArray(session.queue) && session.queue.length
      ? session.queue
      : [session.track];

    if (session.waveActive) {
      waveActiveRef.current = true;
      waveQueueRef.current = queue;
      setWaveActive(true);
    } else {
      waveActiveRef.current = false;
      setWaveActive(false);
    }

    playbackQueueRef.current = queue;
    const restoredQueue = Array.isArray(session.userQueue) ? session.userQueue.filter((item) => item?.id) : [];
    userQueueRef.current = restoredQueue;
    setUserQueue(restoredQueue);
    contextTrackIdRef.current = session.track.id;
    setPlaybackPlaylistId(session.playlistId || null);
    currentTrackRef.current = session.track;
    if (shuffleEnabledRef.current) rebuildShuffledQueue();

    let position = Math.max(0, Number(session.position) || 0);
    const duration = Number(session.track.duration) || 0;
    if (duration > 0 && position >= Math.max(0, duration - 3)) {
      position = 0;
    }

    if (position > 1) {
      setResumeSession({ id: session.track.id, position });
    }
    setCurrentTrack(session.track);
    setIsPlaying(false);
  }, [accountReady, rebuildShuffledQueue]);

  useEffect(() => {
    if (!resumeSession) return;
    if (currentTrack?.id !== resumeSession.id) {
      setResumeSession(null);
    }
  }, [currentTrack, resumeSession]);

  useEffect(() => {
    if (!accountReady || !appSettings.resumePlayback || !currentTrack) return undefined;
    const timer = window.setTimeout(() => persistPlaybackSession(), 900);
    return () => window.clearTimeout(timer);
  }, [
    accountReady,
    appSettings.resumePlayback,
    currentTrack,
    playbackPlaylistId,
    waveActive,
    userQueue,
    isPlaying,
    persistPlaybackSession,
  ]);

  useEffect(() => {
    if (!accountReady) return undefined;
    const onHide = () => persistPlaybackSession();
    const interval = window.setInterval(onHide, 5000);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [accountReady, persistPlaybackSession]);

  useEffect(() => {
    if (!appSettings.resumePlayback) {
      clearPlaybackSession();
    }
  }, [appSettings.resumePlayback]);

  useEffect(() => {
    if (!sleepEndsAt) return undefined;
    const wait = sleepEndsAt - Date.now();
    if (wait <= 0) {
      setIsPlaying(false);
      setSleepEndsAt(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setIsPlaying(false);
      setSleepEndsAt(null);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [sleepEndsAt]);

  const handleSleepTimer = useCallback((minutes) => {
    const value = Number(minutes) || 0;
    if (value <= 0) {
      setSleepEndsAt(null);
      return;
    }
    setSleepEndsAt(Date.now() + value * 60 * 1000);
  }, []);

  const handleResumeConsumed = useCallback(() => {
    setResumeSession(null);
  }, []);

  const exitMiniPlayer = useCallback(async () => {
    setMiniMode(false);
    setMiniWindowOpen(false);
    await closeMiniPlayerWindow();
    await showMainWindow();
  }, []);

  const enterMiniPlayer = useCallback(async () => {
    if (!currentTrackRef.current) return;
    publishMiniPlayerState({
      track: currentTrackRef.current,
      isPlaying: isPlayingRef.current,
    });
    setMiniMode(true);
    if (isDesktopApp()) {
      const opened = await openMiniPlayerWindow();
      if (opened) {
        setMiniWindowOpen(true);
        await hideMainWindow();
      }
    }
  }, []);

  useEffect(() => {
    if (!miniMode) return;
    publishMiniPlayerState({
      track: currentTrack,
      isPlaying,
    });
  }, [miniMode, currentTrack, isPlaying]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('accent-rgb', Boolean(appSettings.accentRgb));
    root.classList.toggle('accent-neutral', Boolean(appSettings.accentNeutral));
    THEME_PRESETS.forEach((theme) => {
      if (theme.id === 'dark') return;
      root.classList.toggle(`theme-${theme.id}`, appSettings.theme === theme.id);
    });
    root.classList.toggle('theme-light', appSettings.theme === 'light' || appSettings.theme === 'paper');
    const accentStrength = Number(appSettings.accentStrength);
    const strength = Number.isFinite(accentStrength)
      ? Math.min(1, Math.max(0.35, accentStrength))
      : 0.7;
    root.style.setProperty('--app-accent-strength', String(strength));

    if (appSettings.accentNeutral) {
      root.style.removeProperty('--app-accent-hue');
      root.style.setProperty('--app-accent-sat', '0%');
    } else if (appSettings.accentRgb) {
      root.style.removeProperty('--app-accent-hue');
      root.style.setProperty('--app-accent-sat', '78%');
    } else {
      root.style.setProperty('--app-accent-hue', String(appSettings.accentHue));
      root.style.setProperty('--app-accent-sat', `${Math.round(strength * 100)}%`);
    }

    const panelOpacity = Number(appSettings.panelOpacity);
    let opacity = Number.isFinite(panelOpacity)
      ? Math.min(1, Math.max(0.55, panelOpacity))
      : 0.88;
    if (appSettings.reduceTransparency) {
      opacity = 1;
    }
    root.style.setProperty('--app-panel-opacity', String(opacity));

    const glassBlur = appSettings.reduceTransparency ? 0 : appSettings.glassBlur;
    root.style.setProperty('--glass-blur', `${glassBlur}px`);
    root.style.setProperty('--app-radius', `${appSettings.uiRoundness}px`);
    root.style.setProperty('--app-radius-lg', `${appSettings.uiRoundness + 8}px`);
    root.style.setProperty('--app-interface-scale', String(appSettings.interfaceScale));
    const motionLevel = appSettings.motionLevel || 'full';
    const animationsOff = !appSettings.animationsEnabled || motionLevel === 'off';
    root.classList.toggle('animations-off', animationsOff);
    root.classList.toggle('hide-album-column', !appSettings.showAlbumColumn);
    root.classList.toggle('compact-ui', appSettings.compactUi);
    root.classList.toggle('reduce-transparency', Boolean(appSettings.reduceTransparency));
    root.dataset.playerBar = appSettings.playerBarStyle || 'pill';
    root.dataset.playerPlay = appSettings.playerPlayStyle || 'solid';
    root.dataset.playerCover = appSettings.playerCoverMotion || 'none';
    root.dataset.playerCoverSize = appSettings.playerCoverSize || 'md';
    root.dataset.playerCoverShape = appSettings.playerCoverShape || 'rounded';
    root.dataset.playerAlign = appSettings.playerAlign || 'spread';
    root.dataset.playerHeight = appSettings.playerHeight || 'normal';
    if (appSettings.showPlayerLikes === false) {
      root.dataset.playerLikes = 'off';
    } else {
      delete root.dataset.playerLikes;
    }
    root.dataset.tracklist = appSettings.trackListStyle || 'comfortable';
    root.dataset.density = appSettings.contentDensity || 'comfortable';
    root.dataset.progress = appSettings.progressStyle || 'line';
    root.dataset.layout = appSettings.layoutStyle || 'floating';
    root.dataset.topbar = appSettings.topBarStyle || 'floating';
    root.dataset.sidebar = appSettings.sidebarStyle || 'panel';
    root.dataset.card = appSettings.cardStyle || 'elevated';
    root.dataset.home = appSettings.homeLayout || 'comfortable';
    root.dataset.motion = motionLevel;
    const coverRadius = Number(appSettings.coverRadius);
    root.style.setProperty(
      '--app-cover-radius',
      `${Number.isFinite(coverRadius) ? Math.min(28, Math.max(8, coverRadius)) : 14}px`
    );
    if (appSettings.sidebarLabels === false) {
      root.dataset.sidebarLabels = 'off';
    } else {
      delete root.dataset.sidebarLabels;
    }
    setUiSoundConfig({
      enabled: appSettings.uiSoundsEnabled,
      volume: appSettings.uiSoundVolume / 100,
      style: appSettings.uiSoundStyle,
      pack: appSettings.uiSoundPack,
    });

    const font = getFontPreset(appSettings.fontId);
    loadGoogleFont(font);
    root.style.setProperty('--app-font', font.stack);

    const bg = String(appSettings.customBackgroundUrl || '').trim();
    if (bg) {
      document.body.style.backgroundImage = `url("${bg}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = isLowPowerMode() ? 'scroll' : 'fixed';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundPosition = '';
      document.body.style.backgroundAttachment = '';
    }
  }, [appSettings]);

  useEffect(() => {
    if (!appSettings.uiSoundsEnabled) return undefined;
    return bindGlobalUiClicks();
  }, [appSettings.uiSoundsEnabled, appSettings.uiSoundVolume, appSettings.uiSoundStyle, appSettings.uiSoundPack]);

  useEffect(() => {
    setHistory((prev) => prev.slice(0, appSettings.historyLimit));
  }, [appSettings.historyLimit]);

  useEffect(() => {
    if (isDesktopApp()) {
      document.documentElement.classList.add('desktop-app');
    }
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;

    let unlisten = () => {};
    listenAppActive((active) => {
      document.documentElement.classList.toggle('app-backgrounded', !active);
      if (!active) {
        document.documentElement.classList.add('animations-off');
      } else if (
        appSettingsRef.current.animationsEnabled &&
        (appSettingsRef.current.motionLevel || 'full') !== 'off'
      ) {
        document.documentElement.classList.remove('animations-off');
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      unlisten();
      document.documentElement.classList.remove('app-backgrounded');
    };
  }, []);

  useEffect(() => {
    fetchTracks();
    fetchPlaylists();
  }, []);

  useEffect(() => {
    initDiscordPresence().catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentTrack) {
      updateDiscordPresence({ idle: true }).catch(() => {});
      syncNowPlaying(null, false).catch(() => {});
      return undefined;
    }

    const sendPresence = () => {
      const slimTrack = slimTrackForProfile(currentTrack);
      updateDiscordPresence(presenceFromTrack(currentTrack, isPlaying)).catch((error) => {
        console.warn('[discord] track presence failed:', error, currentTrack?.title);
      });
      syncNowPlaying(slimTrack, isPlaying).catch(() => {});
    };

    sendPresence();

    const intervalMs = isLowPowerMode()
      ? (isPlaying ? 20000 : 35000)
      : (isPlaying ? 12000 : 25000);
    discordSyncRef.current = setInterval(sendPresence, intervalMs);

    return () => {
      if (discordSyncRef.current) {
        clearInterval(discordSyncRef.current);
        discordSyncRef.current = null;
      }
    };
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (!currentTrack?.artistId || isLowPowerMode()) return undefined;

    prefetchRequest(
      () => axios.get(`/api/artists/${currentTrack.artistId}/profile`).then((res) => res.data),
      `artist-profile:${currentTrack.artistId}`,
      3 * 60 * 1000
    );

    return undefined;
  }, [currentTrack?.artistId]);

  const fetchTracks = async (force = false) => {
    if (tracksLoadedRef.current && !force) return;

    setIsInitialLoading(true);
    try {
      const response = await axios.get('/api/tracks?limit=40');
      setTracks(filterValidTracks(response.data));
      tracksLoadedRef.current = true;
    } catch (error) {
      console.error('Ошибка загрузки треков:', error);
    } finally {
      setIsInitialLoading(false);
    }
  };

  const fetchPlaylists = async () => {
    try {
      const response = await axios.get('/api/playlists');
      setApiPlaylists(response.data);
    } catch (error) {
      console.error('Ошибка загрузки плейлистов:', error);
    }
  };

  const playTrack = useCallback((track, queue, playlistId = null) => {
    const hasContextQueue = Array.isArray(queue) && queue.length > 0;
    if (currentTrack?.id === track.id && !hasContextQueue) {
      setIsPlaying((prev) => {
        playUiSound(prev ? 'pause' : 'play');
        return !prev;
      });
      return;
    }
    waveActiveRef.current = false;
    setWaveActive(false);
    if (playlistId) {
      setPlaybackPlaylistId(playlistId);
    } else if (!hasContextQueue) {
      setPlaybackPlaylistId(null);
    }
    if (hasContextQueue) {
      playbackQueueRef.current = queue;
    } else if (!playbackQueueRef.current.some((item) => item.id === track.id)) {
      playbackQueueRef.current = [track];
    }
    contextTrackIdRef.current = track.id;
    if (shuffleEnabledRef.current) rebuildShuffledQueue();
    if (currentTrack?.id === track.id) return;
    setCurrentTrack(track);
    setIsPlaying(true);
    playUiSound('play');
    setHistory((prev) => addTrackToHistory(prev, track, appSettingsRef.current.historyLimit));
  }, [currentTrack, rebuildShuffledQueue]);

  const playWave = useCallback(async () => {
    if (waveActiveRef.current) {
      setIsPlaying((prev) => {
        playUiSound(prev ? 'pause' : 'play');
        return !prev;
      });
      return true;
    }

    // Wave filter settings UI removed; keep inert defaults for compatibility.
    const waveFilters = {
      noExplicit: false,
      likedOnly: false,
      noRecentRepeats: false,
    };
    const localQueue = buildWaveQueue(history, likedTracks, tracks, waveFilters);
    const excludeIds = [
      ...history.slice(0, 12).map((track) => track.id),
      ...likedTracks.slice(0, 24).map((track) => track.id),
    ];
    if (waveFilters.noRecentRepeats) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      history.forEach((track) => {
        if (Number(track.playedAt) > cutoff) excludeIds.push(track.id);
      });
    }
    let queue = localQueue;

    try {
      const remote = await Promise.race([
        fetchRemoteWave({
          history: waveFilters.likedOnly ? [] : history,
          likedTracks,
          excludeIds,
          likedOnly: waveFilters.likedOnly,
          noExplicit: waveFilters.noExplicit,
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('wave-timeout')), 3200);
        }),
      ]);
      if (Array.isArray(remote) && remote.length) {
        queue = mergeWaveQueues(localQueue, remote);
      }
    } catch {
      // keep the local taste mix
    }

    if (!queue.length) return false;
    queue = applyWaveFilters(queue, { ...waveFilters, likedTracks, history });
    if (!queue.length) return false;

    waveQueueRef.current = queue;
    waveActiveRef.current = true;
    setWaveActive(true);
    setPlaybackPlaylistId(null);
    playbackQueueRef.current = queue;
    contextTrackIdRef.current = queue[0].id;
    if (shuffleEnabledRef.current) rebuildShuffledQueue();
    setCurrentTrack(queue[0]);
    setIsPlaying(true);
    playUiSound('play');
    setHistory((prev) => addTrackToHistory(prev, queue[0], appSettingsRef.current.historyLimit));
    return true;
  }, [history, likedTracks, tracks, rebuildShuffledQueue]);

  const playRadio = useCallback(async (seedTrack) => {
    if (!seedTrack?.id) return false;
    const noExplicit = false;
    let rest = [];
    try {
      const remote = await Promise.race([
        fetchRemoteWave({
          history: [seedTrack],
          likedTracks: [seedTrack],
          excludeIds: [seedTrack.id],
          noExplicit,
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('radio-timeout')), 3200);
        }),
      ]);
      rest = applyWaveFilters(Array.isArray(remote) ? remote : [], {
        noExplicit,
        history,
        likedTracks,
      });
    } catch {
      rest = [];
    }
    const queue = filterValidTracks([seedTrack, ...rest]);
    if (!queue.length) return false;
    playTrack(seedTrack, queue);
    return true;
  }, [history, likedTracks, playTrack]);

  const playPlaylist = useCallback((playlist) => {
    const playlistTracks = playlist?.tracks || [];
    if (playlistTracks.length === 0) return false;

    const isSamePlaylist = playbackPlaylistId === playlist.id;
    const currentInPlaylist = currentTrack && playlistTracks.some((t) => t.id === currentTrack.id);

    if (isSamePlaylist && currentInPlaylist) {
      setIsPlaying((prev) => {
        playUiSound(prev ? 'pause' : 'play');
        return !prev;
      });
      return true;
    }

    waveActiveRef.current = false;
    setWaveActive(false);
    setPlaybackPlaylistId(playlist.id);
    playbackQueueRef.current = playlistTracks;
    contextTrackIdRef.current = playlistTracks[0].id;
    if (shuffleEnabledRef.current) rebuildShuffledQueue();
    setCurrentTrack(playlistTracks[0]);
    setIsPlaying(true);
    playUiSound('play');
    setHistory((prev) =>
      addTrackToHistory(prev, playlistTracks[0], appSettingsRef.current.historyLimit)
    );
    return true;
  }, [currentTrack, playbackPlaylistId, rebuildShuffledQueue]);

  const playAdjacentTrack = useCallback((direction) => {
    if (direction === 1 && takeNextFromUserQueue()) return;

    const queue = getActiveQueue();
    if (!queue.length || !currentTrack) return;

    if (direction === -1) {
      const position = playerRef.current?.getCurrentTime?.()
        || playbackProgressRef.current.position
        || 0;
      if (position > 3) {
        playerRef.current?.seekTo(0);
        return;
      }
    }

    let currentIndex = queue.findIndex((track) => track.id === currentTrack.id);
    if (currentIndex === -1 && contextTrackIdRef.current) {
      currentIndex = queue.findIndex((track) => track.id === contextTrackIdRef.current);
    }
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    const repeat = repeatModeRef.current;

    if (direction === 1 && nextIndex >= queue.length) {
      if (repeat === 'all') nextIndex = 0;
      else return;
    }
    if (direction === -1 && nextIndex < 0) {
      if (repeat === 'all') nextIndex = queue.length - 1;
      else return;
    }

    const nextTrack = queue[nextIndex];
    contextTrackIdRef.current = nextTrack.id;
    setCurrentTrack(nextTrack);
    setIsPlaying(true);
    setHistory((prev) => addTrackToHistory(prev, nextTrack, appSettingsRef.current.historyLimit));
  }, [currentTrack, getActiveQueue, takeNextFromUserQueue]);

  useEffect(() => {
    if (!miniMode) return undefined;
    return listenMiniPlayerAction((type) => {
      if (type === 'toggle') {
        setIsPlaying((prev) => !prev);
        return;
      }
      if (type === 'next') {
        playAdjacentTrack(1);
        return;
      }
      if (type === 'restore') {
        exitMiniPlayer();
      }
    });
  }, [miniMode, playAdjacentTrack, exitMiniPlayer]);

  useEffect(() => {
    if (miniMode && !currentTrack) {
      exitMiniPlayer();
    }
  }, [miniMode, currentTrack, exitMiniPlayer]);

  const handleTrackFinish = useCallback(() => {
    if (repeatModeRef.current === 'one') {
      playerRef.current?.seekTo(0);
      setIsPlaying(true);
      return true;
    }

    if (!appSettingsRef.current.autoplayNext && repeatModeRef.current === 'off') {
      setIsPlaying(false);
      return false;
    }

    if (takeNextFromUserQueue()) return true;

    const queue = getActiveQueue();
    if (!queue.length || !currentTrack) return false;

    let currentIndex = queue.findIndex((track) => track.id === currentTrack.id);
    if (currentIndex === -1 && contextTrackIdRef.current) {
      currentIndex = queue.findIndex((track) => track.id === contextTrackIdRef.current);
    }
    let nextTrack = queue[currentIndex + 1];

    if (!nextTrack && repeatModeRef.current === 'all') {
      nextTrack = queue[0];
    }

    if (!nextTrack) {
      if (waveActiveRef.current) {
        waveActiveRef.current = false;
        setWaveActive(false);
      }
      setIsPlaying(false);
      return false;
    }

    setCurrentTrack(nextTrack);
    setIsPlaying(true);
    contextTrackIdRef.current = nextTrack.id;
    setHistory((prev) => addTrackToHistory(prev, nextTrack, appSettingsRef.current.historyLimit));
    return true;
  }, [currentTrack, getActiveQueue, takeNextFromUserQueue]);

  const handleKeybindAction = useCallback((action) => {
    const keybinds = appSettingsRef.current.keybinds;
    if (!keybinds?.enabled) return;

    const step = keybinds.volumeStep || 5;

    switch (action) {
      case 'volumeUp':
        if (playerRef.current) playerRef.current.volumeUp(step);
        else adjustStoredVolume(step);
        break;
      case 'volumeDown':
        if (playerRef.current) playerRef.current.volumeDown(step);
        else adjustStoredVolume(-step);
        break;
      case 'mute':
        if (playerRef.current) playerRef.current.toggleMute();
        else toggleStoredMute();
        break;
      case 'playPause':
        if (!currentTrackRef.current) return;
        setIsPlaying((prev) => {
          playUiSound(prev ? 'pause' : 'play');
          return !prev;
        });
        break;
      case 'nextTrack':
        if (!currentTrackRef.current) return;
        playAdjacentTrack(1);
        break;
      case 'prevTrack':
        if (!currentTrackRef.current) return;
        playAdjacentTrack(-1);
        break;
      case 'favoriteTrack': {
        const track = currentTrackRef.current;
        if (!track) return;
        setLikedTracks((prev) => (
          toggleLikedTrack(prev, track)
        ));
        playUiSound('like');
        break;
      }
      default:
        break;
    }
  }, [playAdjacentTrack]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (document.body.dataset.keybindCapture === '1') return;
      if (isEditableTarget(event.target)) return;

      const keybinds = appSettingsRef.current.keybinds;
      if (!keybinds?.enabled) return;

      const bindings = [
        ['volumeUp', keybinds.volumeUp],
        ['volumeDown', keybinds.volumeDown],
        ['mute', keybinds.mute],
        ['playPause', keybinds.playPause],
        ['nextTrack', keybinds.nextTrack],
        ['prevTrack', keybinds.prevTrack],
        ['favoriteTrack', keybinds.favoriteTrack],
      ];

      for (const [action, bind] of bindings) {
        if (!matchesKeybind(event, bind)) continue;

        // Desktop: modifier chords are owned by OS global shortcuts (avoid double fire).
        if (isDesktopApp() && (bind.ctrl || bind.alt || bind.meta)) {
          return;
        }

        if (action === 'playPause' || action === 'nextTrack' || action === 'prevTrack' || action === 'favoriteTrack') {
          if (!currentTrackRef.current) return;
        }

        event.preventDefault();
        handleKeybindAction(action);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeybindAction]);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;

    let unlisten = () => {};

    syncGlobalKeybinds(appSettings.keybinds).catch(() => {});
    listenGlobalKeybinds(handleKeybindAction)
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      unlisten();
    };
  }, [appSettings.keybinds, handleKeybindAction]);

  const toggleLike = useCallback((track) => {
    playUiSound('like');
    setLikedTracks((prev) => toggleLikedTrack(prev, track));
  }, []);

  const handleCreatePlaylist = useCallback((data) => {
    const playlist = createPlaylist(
      typeof data === 'string' ? { name: data } : data
    );
    setUserPlaylists((prev) => [playlist, ...prev]);
    return playlist;
  }, []);

  const handleImportPlaylist = useCallback(async ({ name, input }) => {
    const response = await axios.post('/api/import-playlist', { name, input });
    const imported = response.data || {};
    const playlist = createPlaylist({
      name: imported.name || name || 'Imported playlist',
      description: imported.description || '',
      cover: imported.cover,
      tracks: filterValidTracks(imported.tracks || []),
      source: imported.source || 'import',
    });

    setUserPlaylists((prev) => [playlist, ...prev]);
    setActivePlaylistId(playlist.id);
    setCurrentView('playlist');
    return playlist;
  }, []);

  const handleUpdatePlaylist = useCallback((id, updates) => {
    setUserPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const handleRemoveTrackFromPlaylist = useCallback((playlistId, trackId) => {
    setUserPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) };
      })
    );
  }, []);

  const handleReorderPlaylistTracks = useCallback((playlistId, fromIndex, toIndex) => {
    setUserPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const nextTracks = [...p.tracks];
        const [moved] = nextTracks.splice(fromIndex, 1);
        nextTracks.splice(toIndex, 0, moved);
        return { ...p, tracks: nextTracks };
      })
    );
  }, []);

  const handleDeletePlaylist = useCallback((id) => {
    setUserPlaylists((prev) => prev.filter((p) => p.id !== id));
    if (activePlaylistId === id) {
      setActivePlaylistId(null);
      setCurrentView('library');
    }
  }, [activePlaylistId]);

  const handleAddTrackToPlaylist = useCallback((playlistId, track) => {
    setUserPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.tracks.some((t) => t.id === track.id)) return p;
        return { ...p, tracks: [...p.tracks, track] };
      })
    );
  }, []);

  const handleSearch = (query) => {
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      setSearchArtistResults([]);
      if (currentViewRef.current === 'search') {
        return;
      }
      setCurrentView('home');
      fetchTracks();
      return;
    }

    setCurrentView('search');
    setActiveArtistId(null);

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await cachedRequest(
          () =>
            axios
              .get(`/api/search?q=${encodeURIComponent(query)}&trackLimit=50&artistLimit=20`)
              .then((res) => res.data),
          `search:${query.toLowerCase()}`,
          2 * 60 * 1000
        );
        const tracks = filterValidTracks(Array.isArray(data) ? data : data.tracks || []);
        const artists = Array.isArray(data) ? [] : data.artists || [];
        setSearchResults(tracks);
        setSearchArtistResults(artists);
        if (tracks.length) {
          setSearchRecent((prev) => addSearchRecentTracks(prev, tracks));
        }
      } catch (error) {
        console.error('Ошибка поиска:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const openArtist = useCallback((artist) => {
    if (!artist?.id) return;
    setActiveArtistId(artist.id);
    setCurrentView('artist');
    setActivePlaylistId(null);
    setProfileEditing(false);
  }, []);

  const openArtistFromTrack = useCallback(async (track) => {
    if (!track) return;

    if (track.artistId) {
      openArtist({
        id: track.artistId,
        username: track.artist,
        avatar: track.cover,
      });
      return;
    }

    if (!track.artist || track.artist === 'Unknown') return;

    const cacheKey = track.artist.toLowerCase();
    const cachedArtist = artistResolveCacheRef.current.get(cacheKey);
    if (cachedArtist?.id) {
      openArtist(cachedArtist);
      return;
    }

    try {
      const artist = await cachedRequest(
        () =>
          axios
            .get(`/api/artists/resolve?username=${encodeURIComponent(track.artist)}`)
            .then((res) => res.data),
        `artist-resolve:${cacheKey}`,
        30 * 60 * 1000
      );

      if (artist?.id) {
        artistResolveCacheRef.current.set(cacheKey, artist);
        if (artistResolveCacheRef.current.size > 80) {
          const oldest = artistResolveCacheRef.current.keys().next().value;
          artistResolveCacheRef.current.delete(oldest);
        }
        openArtist(artist);
      }
    } catch {
      // ignore lookup errors
    }
  }, [openArtist]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleNavChange = (view) => {
    const prev = currentViewRef.current;
    setCurrentView(view);
    setActivePlaylistId(null);
    setActiveArtistId(null);
    setViewUserId(null);
    setExternalPlaylist(null);
    setExternalPlaylistOwner('');
    if (view !== 'profile') {
      setProfileEditing(false);
    }
    if (view === 'home' && tracks.length === 0) {
      fetchTracks();
    }
    if (view === 'search') {
      setIsSearching(false);
    } else if (prev === 'search') {
      setSearchResults([]);
      setSearchArtistResults([]);
      setIsSearching(false);
    }
  };

  const openPlaylist = (playlist) => {
    setExternalPlaylist(null);
    setExternalPlaylistOwner('');
    setActivePlaylistId(playlist.id);
    setCurrentView('playlist');
  };

  const openFriendPlaylist = useCallback(async (userId, playlistSummary) => {
    if (!userId || !playlistSummary?.id) return;

    try {
      const data = await fetchFriendPlaylist(userId, playlistSummary.id);
      setExternalPlaylist(data.playlist);
      setExternalPlaylistOwner(data.ownerName || '');
      setActivePlaylistId(data.playlist.id);
      setCurrentView('playlist');
    } catch (error) {
      console.error('Friend playlist load failed:', error);
    }
  }, []);

  const allPlaylists = [...userPlaylists, ...apiPlaylists];

  const activePlaylist =
    allPlaylists.find((p) => p.id === activePlaylistId)
    || (externalPlaylist?.id === activePlaylistId ? externalPlaylist : null);

  const renderMain = () => {
    if (currentView === 'profile') {
      return (
        <Profile
          profile={profile}
          onUpdateProfile={(updates) => setProfile((prev) => ({ ...prev, ...updates }))}
          onSyncProfile={syncProfileToServer}
          userPlaylists={userPlaylists}
          likedTracks={likedTracks}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          playTrack={playTrack}
          playPlaylist={playPlaylist}
          playbackPlaylistId={playbackPlaylistId}
          toggleLike={toggleLike}
          isTrackLiked={(id) => isTrackLiked(likedTracks, id)}
          onOpenPlaylist={openPlaylist}
          onOpenArtist={openArtistFromTrack}
          pinnedTrack={authUser?.pinnedTrack || null}
          onPinTrack={handlePinTrack}
          onUnpinTrack={handleUnpinTrack}
          startEditing={profileEditing}
          onEditingChange={setProfileEditing}
          onLogout={handleLogout}
          equippedCosmetics={authUser?.equippedCosmetics || null}
          isAdmin={authUser?.isAdmin}
        />
      );
    }
    if (currentView === 'friends') {
      return <Friends onOpenUserProfile={openUserProfile} playTrack={playTrack} />;
    }
    if (currentView === 'chat') {
      return (
        <GlobalChat
          active={currentView === 'chat'}
          currentUserId={authUser?.id}
          currentUserAvatar={profile.avatarUrl}
          onOpenUserProfile={openUserProfile}
        />
      );
    }
    if (currentView === 'user-profile' && viewUserId) {
      return (
        <UserProfile
          userId={viewUserId}
          onBack={() => {
            setViewUserId(null);
            setCurrentView('friends');
          }}
          onOpenPlaylist={(playlist) => openFriendPlaylist(viewUserId, playlist)}
          playTrack={playTrack}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
        />
      );
    }
    if (currentView === 'marketplace') {
      return (
        <Marketplace
          currentUserId={authUser?.id}
          renderCoins={authUser?.renderCoins ?? 0}
          onApplyWorkshopItem={handleWorkshopApply}
          onBalanceChange={handleMarketplaceBalanceChange}
          onCosmeticsChange={handleMarketplaceCosmeticsChange}
        />
      );
    }
    if (currentView === 'admin') {
      if (!authUser?.isAdmin) {
        return null;
      }
      return <AdminPanel currentUserId={authUser?.id} />;
    }
    if (currentView === 'settings') {
      return (
        <Settings
          appSettings={appSettings}
          onAppSettingsChange={setAppSettings}
          sleepEndsAt={sleepEndsAt}
          onSleepTimer={handleSleepTimer}
          onBackgroundSave={async (customBackgroundUrl) => {
            setAppSettings((prev) => ({ ...prev, customBackgroundUrl }));
            await syncProfileToServer({ backgroundUrl: customBackgroundUrl });
          }}
          onBackgroundUpload={uploadAccountBackground}
          onOpenWorkshop={() => setCurrentView('marketplace')}
          onOpenAdmin={() => setCurrentView('admin')}
          onClearHistory={() => setHistory([])}
          onClearLiked={() => setLikedTracks([])}
          authUser={authUser}
          privacy={privacyFromUser(authUser)}
          onPrivacyChange={handlePrivacyChange}
          onLogout={handleLogout}
        />
      );
    }
    if (currentView === 'artist' && activeArtistId) {
      return (
        <div className="main-content">
          <ArtistView
            artistId={activeArtistId}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={playTrack}
            playbackPlaylistId={playbackPlaylistId}
            toggleLike={toggleLike}
            isTrackLiked={(id) => isTrackLiked(likedTracks, id)}
            userPlaylists={userPlaylists}
            onAddToPlaylist={handleAddTrackToPlaylist}
            onCreatePlaylist={() => setCurrentView('library')}
            onOpenArtist={openArtist}
            onOpenArtistFromTrack={openArtistFromTrack}
          />
        </div>
      );
    }
    return (
      <MainContent
        tracks={tracks}
        history={history}
        likedTracks={likedTracks}
        playlists={allPlaylists}
        userPlaylists={userPlaylists}
        activePlaylist={activePlaylist}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
          playTrack={playTrack}
        playWave={playWave}
        waveActive={waveActive}
        onOpenEqualizer={openEqualizer}
        playPlaylist={playPlaylist}
        playbackPlaylistId={playbackPlaylistId}
        toggleLike={toggleLike}
        isTrackLiked={(id) => isTrackLiked(likedTracks, id)}
        currentView={currentView}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searchArtistResults={searchArtistResults}
        searchRecent={searchRecent}
        onSearch={handleSearch}
        onOpenArtist={openArtist}
        onOpenArtistFromTrack={openArtistFromTrack}
        onNavigate={handleNavChange}
        onCreatePlaylist={handleCreatePlaylist}
        onImportPlaylist={handleImportPlaylist}
        onDeletePlaylist={handleDeletePlaylist}
        onOpenPlaylist={openPlaylist}
        onAddTrackToPlaylist={handleAddTrackToPlaylist}
        onUpdatePlaylist={handleUpdatePlaylist}
        onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
        onReorderPlaylistTracks={handleReorderPlaylistTracks}
        profileDisplayName={externalPlaylistOwner || profile.displayName || profile.username}
        isInitialLoading={isInitialLoading}
        isSearching={isSearching}
      />
    );
  };

  if (!authChecked) {
    return <BootSplash ready={false} />;
  }

  if (!authUser) {
    return (
      <>
        <BootSplash ready />
        <AuthScreen onAuthenticated={handleAuthenticated} />
      </>
    );
  }

  return (
    <>
    <BootSplash ready />
    <CallProvider enabled={Boolean(authUser)}>
    <VoiceCall />
    <PlaybackExtrasContext.Provider
      value={{
        userQueue,
        addToQueue,
        playNext: playNextInQueue,
        playRadio,
        removeFromQueue,
        clearQueue,
        moveInQueue,
      }}
    >
    <div className={`app${currentTrack ? ' has-player' : ''}`}>
      <div className="app-shell">
        <TopBar
          currentView={currentView}
          setCurrentView={handleNavChange}
          onOpenProfile={() => {
            setProfileEditing(false);
            setCurrentView('profile');
          }}
          onOpenSettings={() => setCurrentView('settings')}
          avatarUrl={profile.avatarUrl}
          searchQuery={searchQuery}
          onSearch={handleSearch}
          isSearching={isSearching}
        />
        <div className="app-body">
          <div className="content-stage">
            <div className="app-main">
              <div
                key={
                  currentView === 'playlist'
                    ? `playlist-${activePlaylistId}`
                    : currentView === 'artist'
                      ? `artist-${activeArtistId}`
                      : currentView
                }
                className="page-view"
              >
                {renderMain()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`bottom-chrome${currentTrack && !miniMode ? ' has-player' : ''}${miniMode ? ' is-mini' : ''}`}>
        {currentTrack && (
          <div className="bottom-chrome__player" hidden={miniMode}>
            <Player
              ref={playerRef}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              setIsPlaying={(value) => {
                setIsPlaying((prev) => {
                  const next = typeof value === 'function' ? value(prev) : value;
                  if (next !== prev) {
                    playUiSound(next ? 'play' : 'pause');
                  }
                  return next;
                });
              }}
              isLiked={isTrackLiked(likedTracks, currentTrack.id)}
              onToggleLike={() => toggleLike(currentTrack)}
              onTrackFinish={handleTrackFinish}
              onPrevious={() => playAdjacentTrack(-1)}
              onNext={() => playAdjacentTrack(1)}
              shuffleEnabled={shuffleEnabled}
              onToggleShuffle={toggleShuffle}
              repeatMode={repeatMode}
              onToggleRepeat={toggleRepeat}
              onPlaybackProgress={(position, duration) => {
                playbackProgressRef.current = { position, duration };
              }}
              userPlaylists={userPlaylists}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={() => setCurrentView('library')}
              onOpenArtist={openArtistFromTrack}
              resumePosition={resumeSession?.id === currentTrack.id ? resumeSession.position : 0}
              onResumeConsumed={handleResumeConsumed}
              crossfadeSeconds={Number(appSettings.crossfadeSeconds) || 0}
              allowCrossfade={(appSettings.autoplayNext || repeatMode === 'all') && repeatMode !== 'one'}
              sleepEndsAt={sleepEndsAt}
              normalizeLoudness={Boolean(appSettings.normalizeLoudness)}
              onEnterMini={enterMiniPlayer}
              userQueue={userQueue}
              onRemoveFromQueue={removeFromQueue}
              onClearQueue={clearQueue}
              onMoveInQueue={moveInQueue}
              onPlayQueuedTrack={(track) => {
                removeFromQueue(track.id);
                setCurrentTrack(track);
                setIsPlaying(true);
                setHistory((prev) => addTrackToHistory(prev, track, appSettingsRef.current.historyLimit));
              }}
            />
          </div>
        )}
        {miniMode && currentTrack && !miniWindowOpen && (
          <MiniPlayerOverlay
            track={currentTrack}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((prev) => !prev)}
            onNext={() => playAdjacentTrack(1)}
            onExpand={exitMiniPlayer}
          />
        )}
      </div>
    </div>
    </PlaybackExtrasContext.Provider>
    </CallProvider>
    </>
  );
}

function App() {
  if (isMiniPlayerWindow()) {
    return (
      <LanguageProvider>
        <BootSplash ready instant />
        <MiniPlayerWindow />
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <TitleBar />
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
