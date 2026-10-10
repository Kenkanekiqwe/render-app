import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import './Player.css';
import {
  FaPlay,
  FaPause,
  FaStepBackward,
  FaStepForward,
  FaRandom,
  FaRedo,
  FaVolumeUp,
  FaVolumeMute,
  FaHeart,
  FaRegHeart,
  FaSlidersH,
  FaMoon,
  FaCompress,
  FaList,
  FaEllipsisH,
} from 'react-icons/fa';
import AddToPlaylistMenu from './AddToPlaylistMenu';
import NowPlayingOverlay from './NowPlayingOverlay';
import PlayerEqualizer from './PlayerEqualizer';
import PlayerSpeedControl from './PlayerSpeedControl';
import TrackDownloadButton from './TrackDownloadButton';
import PlayQueue from './PlayQueue';
import { useLanguage } from '../context/LanguageContext';
import { loadPlayerPrefs, savePlayerPrefs } from '../utils/storage';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';
import { resolvePublicMediaUrl } from '../utils/mediaUrl';
import { applyEqGains, applyNormalization, createEqualizerChain, normalizeEqGains } from '../utils/equalizer';
import { getCachedTrack, hasCachedTrack, saveTrackOffline, removeCachedTrack } from '../utils/offlineCache';
import { applyPlaybackRate, normalizePlaybackRate } from '../utils/streamPlayback';

function getStreamInfoUrl(track, { refresh = false } = {}) {
  if (!track?.id) return '';
  const base = `/api/stream/${track.id}/info`;
  return refresh ? `${base}?refresh=1` : base;
}

function getStreamUrl(track, { refresh = false } = {}) {
  if (!track?.id) return '';
  const params = new URLSearchParams({ proxy: '1' });
  if (refresh) params.set('refresh', '1');
  return `/api/stream/${track.id}?${params.toString()}`;
}

function destroyHls(hlsRef) {
  if (hlsRef.current) {
    try {
      hlsRef.current.destroy();
    } catch {
      // ignore
    }
    hlsRef.current = null;
  }
}

function haltMediaElement(audio) {
  if (!audio) return;
  try {
    audio.pause();
  } catch {
    // ignore
  }
  try {
    audio.removeAttribute('src');
    audio.srcObject = null;
    audio.src = '';
  } catch {
    // ignore
  }
}

function isEqSafeSrc(src) {
  const value = String(src || '');
  if (!value) return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return true;
  if (/workers\.dev|\/sc-relay(?:\?|$)/i.test(value)) {
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

function isEqSafeMedia(audio) {
  return isEqSafeSrc(audio?.currentSrc) || isEqSafeSrc(audio?.src);
}

function Player({
  currentTrack,
  isPlaying,
  setIsPlaying,
  isLiked,
  onToggleLike,
  onTrackFinish,
  onPrevious,
  onNext,
  onPlaybackProgress,
  onOpenArtist,
  userPlaylists,
  onAddToPlaylist,
  onCreatePlaylist,
  shuffleEnabled = false,
  onToggleShuffle,
  repeatMode = 'off',
  onToggleRepeat,
  resumePosition = 0,
  onResumeConsumed,
  crossfadeSeconds = 0,
  allowCrossfade = true,
  sleepEndsAt = null,
  normalizeLoudness = false,
  onEnterMini,
  userQueue = [],
  onRemoveFromQueue,
  onClearQueue,
  onMoveInQueue,
  onPlayQueuedTrack,
}, ref) {
  const { t } = useLanguage();
  const initialPrefs = loadPlayerPrefs();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(initialPrefs.volume);
  const [isMuted, setIsMuted] = useState(initialPrefs.muted);
  const [audioReady, setAudioReady] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [coverOrigin, setCoverOrigin] = useState(null);
  const [eqOpen, setEqOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(() => normalizePlaybackRate(loadPlayerPrefs()?.playbackRate));
  const [audioEpoch, setAudioEpoch] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState(null);
  const moreMenuButtonRef = useRef(null);
  const moreMenuRef = useRef(null);
  const [offlineState, setOfflineState] = useState('idle');
  const [eqGains, setEqGains] = useState(initialPrefs.eqGains);
  const [eqPreset, setEqPreset] = useState(initialPrefs.eqPreset);
  const [sleepNow, setSleepNow] = useState(() => Date.now());
  const durationRef = useRef(0);
  const playerProgressFillRef = useRef(null);
  const overlayProgressFillRef = useRef(null);
  const lastProgressStateAtRef = useRef(0);

  const handleOpenLyrics = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCoverOrigin({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      size: rect.width,
    });
    setLyricsOpen(true);
  }, []);

  const handleCloseLyrics = useCallback(() => {
    setLyricsOpen(false);
  }, []);

  useEffect(() => {
    if (lyricsOpen) return undefined;
    const timer = window.setTimeout(() => setCoverOrigin(null), 500);
    return () => window.clearTimeout(timer);
  }, [lyricsOpen]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const eqFiltersRef = useRef([]);
  const eqGainRef = useRef(null);
  const compressorRef = useRef(null);
  const makeupGainRef = useRef(null);
  const eqReadyRef = useRef(false);
  const fadeGainRef = useRef(1);
  const fadeRafRef = useRef(0);
  const crossfadeLockRef = useRef(false);
  const skipEndedRef = useRef(false);
  const blobUrlRef = useRef(null);
  const shouldFadeInRef = useRef(false);
  const resumePositionRef = useRef(resumePosition);
  const crossfadeSecondsRef = useRef(crossfadeSeconds);
  const allowCrossfadeRef = useRef(allowCrossfade);
  const repeatModeLocalRef = useRef(repeatMode);
  const normalizeRef = useRef(normalizeLoudness);
  const loadedTrackIdRef = useRef(null);
  const isLoadingRef = useRef(false);
  const shouldPlayRef = useRef(false);
  const playAttemptRef = useRef(0);
  const streamRetryRef = useRef(false);
  const attachGenerationRef = useRef(0);
  const pendingStreamRef = useRef(null);
  const currentTrackRef = useRef(currentTrack);
  const volumeFillRef = useRef(null);
  const onTrackFinishRef = useRef(onTrackFinish);
  const volumeBeforeMuteRef = useRef(initialPrefs.volume);
  const volumeRef = useRef(initialPrefs.volume);
  const isMutedRef = useRef(initialPrefs.muted);

  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  const onResumeConsumedRef = useRef(onResumeConsumed);
  onPlaybackProgressRef.current = onPlaybackProgress;
  onTrackFinishRef.current = onTrackFinish;
  onResumeConsumedRef.current = onResumeConsumed;

  useEffect(() => {
    volumeRef.current = volume;
    isMutedRef.current = isMuted;
  }, [volume, isMuted]);

  const syncVolumeFill = useCallback((value) => {
    if (volumeFillRef.current) {
      volumeFillRef.current.style.width = `${value}%`;
    }
  }, []);

  const syncProgressVisual = useCallback((position, totalDuration) => {
    const total = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : durationRef.current;
    const percent = total > 0 ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;
    const width = `${percent}%`;

    if (playerProgressFillRef.current) {
      playerProgressFillRef.current.style.width = width;
    }
    if (overlayProgressFillRef.current) {
      overlayProgressFillRef.current.style.width = width;
    }
  }, []);

  const applyPlaybackPosition = useCallback((position, nextDuration) => {
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      durationRef.current = nextDuration;
      setDuration((prev) => (Math.abs(prev - nextDuration) > 0.5 ? nextDuration : prev));
    }

    syncProgressVisual(position, durationRef.current);

    const now = performance.now();
    if (now - lastProgressStateAtRef.current >= 500) {
      lastProgressStateAtRef.current = now;
      setCurrentTime(position);
      onPlaybackProgressRef.current?.(position, durationRef.current);
    }
  }, [syncProgressVisual]);

  useLayoutEffect(() => {
    syncProgressVisual(currentTime, duration);
  }, [currentTime, duration, syncProgressVisual, lyricsOpen]);

  resumePositionRef.current = resumePosition;
  crossfadeSecondsRef.current = crossfadeSeconds;
  allowCrossfadeRef.current = allowCrossfade;
  repeatModeLocalRef.current = repeatMode;
  normalizeRef.current = normalizeLoudness;
  currentTrackRef.current = currentTrack;

  const applyAudioVolume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const storedVolume = volumeRef.current;
    const muted = isMutedRef.current;
    const fade = Number.isFinite(fadeGainRef.current) ? fadeGainRef.current : 1;
    const effectiveVolume = (muted ? 0 : storedVolume / 100) * Math.max(0, Math.min(1, fade));

    if (eqGainRef.current) {
      audio.volume = 1;
      eqGainRef.current.gain.value = effectiveVolume;
    } else {
      audio.volume = effectiveVolume;
    }
    syncVolumeFill(muted ? 0 : storedVolume);
  }, [syncVolumeFill]);

  const stopFade = useCallback(() => {
    if (fadeRafRef.current) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = 0;
    }
  }, []);

  useEffect(() => () => stopFade(), [stopFade]);

  const animateFade = useCallback((from, to, durationMs, onDone) => {
    stopFade();
    const start = performance.now();
    const span = Math.max(80, Number(durationMs) || 0);

    const step = (now) => {
      const progress = Math.min(1, (now - start) / span);
      fadeGainRef.current = from + (to - from) * progress;
      applyAudioVolume();
      if (progress < 1) {
        fadeRafRef.current = requestAnimationFrame(step);
        return;
      }
      fadeRafRef.current = 0;
      onDone?.();
    };

    fadeGainRef.current = from;
    applyAudioVolume();
    fadeRafRef.current = requestAnimationFrame(step);
  }, [applyAudioVolume, stopFade]);

  const resetWebAudio = useCallback(() => {
    try {
      audioCtxRef.current?.close?.();
    } catch {
      // ignore
    }
    audioCtxRef.current = null;
    eqFiltersRef.current = [];
    eqGainRef.current = null;
    compressorRef.current = null;
    makeupGainRef.current = null;
    eqReadyRef.current = false;
  }, []);

  const unlockAudioContext = useCallback(async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContextClass();
    }
    if (audioCtxRef.current.state === 'suspended') {
      try {
        await audioCtxRef.current.resume();
      } catch {
        // wait for the next user gesture
      }
    }
    return audioCtxRef.current;
  }, []);

  const remountAudio = useCallback((track, refresh = false) => {
    if (!track?.id) return;
    pendingStreamRef.current = { track, refresh };
    playAttemptRef.current += 1;
    attachGenerationRef.current += 1;
    isLoadingRef.current = true;
    destroyHls(hlsRef);
    haltMediaElement(audioRef.current);
    resetWebAudio();
    setAudioEpoch((n) => n + 1);
  }, [resetWebAudio]);

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || eqReadyRef.current) return false;
    if (!isEqSafeMedia(audio)) return false;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;

      const ctx = audioCtxRef.current && audioCtxRef.current.state !== 'closed'
        ? audioCtxRef.current
        : new AudioContextClass();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return false;
        }
      }
      if (ctx.state !== 'running') return false;

      const chain = createEqualizerChain(ctx, audio, eqGains);
      audio.volume = 1;
      eqFiltersRef.current = chain.filters;
      eqGainRef.current = chain.gainNode;
      compressorRef.current = chain.compressor;
      makeupGainRef.current = chain.makeupGain;
      eqReadyRef.current = true;
      applyEqGains(chain.filters, eqGains);
      applyNormalization(chain.compressor, chain.makeupGain, normalizeRef.current);
      applyAudioVolume();
      return true;
    } catch {
      eqReadyRef.current = false;
      return false;
    }
  }, [applyAudioVolume, eqGains]);

  const playAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    await unlockAudioContext();

    if (eqReadyRef.current && audioCtxRef.current?.state === 'suspended') {
      try {
        await audioCtxRef.current.resume();
      } catch {
        // fall through
      }
    }

    // MediaElementSource + suspended context = progress without sound.
    if (eqReadyRef.current && audioCtxRef.current?.state !== 'running') {
      remountAudio(currentTrackRef.current);
      return;
    }

    if (isEqSafeMedia(audio)) {
      await ensureAudioGraph();
    }

    const attemptId = ++playAttemptRef.current;
    const trackId = String(currentTrackRef.current?.id || '');
    try {
      await audio.play();
      if (attemptId !== playAttemptRef.current) return;
      if (String(currentTrackRef.current?.id || '') !== trackId) return;
      if (!audio.currentSrc && !audio.src) return;
      if (!eqReadyRef.current && isEqSafeMedia(audio)) {
        await ensureAudioGraph();
      }
    } catch (error) {
      if (attemptId !== playAttemptRef.current) return;
      if (error?.name === 'AbortError') return;
      setIsPlaying(false);
    }
  }, [ensureAudioGraph, remountAudio, setIsPlaying, unlockAudioContext]);

  useEffect(() => {
    const onGesture = () => {
      unlockAudioContext().then(() => ensureAudioGraph());
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [ensureAudioGraph, unlockAudioContext]);

  const playAudioRef = useRef(playAudio);
  const ensureAudioGraphRef = useRef(ensureAudioGraph);
  const attachStreamRef = useRef(null);
  playAudioRef.current = playAudio;
  ensureAudioGraphRef.current = ensureAudioGraph;

  const attachStream = useCallback(async (track, { refresh = false } = {}) => {
    const audio = audioRef.current;
    if (!audio || !track?.id) return;

    const generation = ++attachGenerationRef.current;
    playAttemptRef.current += 1;
    isLoadingRef.current = true;
    setAudioReady(false);
    destroyHls(hlsRef);
    haltMediaElement(audio);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    const markReady = () => {
      if (generation !== attachGenerationRef.current) return;
      isLoadingRef.current = false;
      const audioEl = audioRef.current;
      const resumeAt = resumePositionRef.current;
      if (audioEl && resumeAt > 1) {
        try {
          audioEl.currentTime = resumeAt;
        } catch {
          // ignore
        }
        onResumeConsumedRef.current?.();
      }
      if (shouldFadeInRef.current && crossfadeSecondsRef.current > 0) {
        shouldFadeInRef.current = false;
        animateFade(0, 1, crossfadeSecondsRef.current * 1000);
      }
      if (shouldPlayRef.current) {
        playAudioRef.current();
      } else if (isEqSafeMedia(audioEl || audio)) {
        ensureAudioGraphRef.current();
      }
    };

    try {
      const cached = await getCachedTrack(track.id);
      if (generation !== attachGenerationRef.current) return;
      if (cached?.blob) {
        const localUrl = URL.createObjectURL(cached.blob);
        blobUrlRef.current = localUrl;
        audio.addEventListener('canplay', markReady, { once: true });
        audio.src = localUrl;
        audio.load();
        return;
      }

      const infoRes = await fetch(getStreamInfoUrl(track, { refresh }));
      if (generation !== attachGenerationRef.current) return;

      if (!infoRes.ok) {
        throw new Error(`stream info ${infoRes.status}`);
      }

      const info = await infoRes.json();
      if (generation !== attachGenerationRef.current) return;

      if (info.protocol === 'hls') {
        const sourceUrl = resolvePublicMediaUrl(info.url || info.rewriteUrl);
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            maxBufferLength: 30,
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, markReady);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data?.fatal || generation !== attachGenerationRef.current) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && info.rewriteUrl && sourceUrl !== info.rewriteUrl) {
              hls.loadSource(info.rewriteUrl);
              return;
            }
            hls.destroy();
            hlsRef.current = null;
            isLoadingRef.current = false;
            setAudioReady(false);
            setIsPlaying(false);
          });
          hls.loadSource(sourceUrl);
          hls.attachMedia(audio);
          return;
        }

        if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          if (eqReadyRef.current && !isEqSafeSrc(sourceUrl)) {
            remountAudio(track, refresh);
            return;
          }
          audio.addEventListener('canplay', markReady, { once: true });
          audio.src = sourceUrl;
          audio.load();
          return;
        }
      }

      // Prefer same-origin proxied progressive so MediaElementSource/EQ works.
      const progressiveUrl = getStreamUrl(track, { refresh });
      audio.addEventListener('canplay', markReady, { once: true });
      audio.src = progressiveUrl;
      audio.load();
    } catch {
      if (generation !== attachGenerationRef.current) return;
      isLoadingRef.current = false;
      setAudioReady(false);
      setIsPlaying(false);
    }
  }, [animateFade, remountAudio, setIsPlaying]);

  attachStreamRef.current = attachStream;

  const reloadStream = useCallback((refresh = false) => {
    if (!currentTrack?.id) return;
    attachStream(currentTrack, { refresh });
  }, [attachStream, currentTrack]);

  useEffect(() => {
    shouldPlayRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    applyEqGains(eqFiltersRef.current, eqGains);
    savePlayerPrefs({
      ...loadPlayerPrefs(),
      eqGains,
      eqPreset,
    });
  }, [eqGains, eqPreset]);

  useEffect(() => {
    normalizeRef.current = normalizeLoudness;
    applyNormalization(compressorRef.current, makeupGainRef.current, normalizeLoudness);
  }, [normalizeLoudness]);

  useEffect(() => {
    syncVolumeFill(isMuted ? 0 : volume);
  }, [volume, isMuted, syncVolumeFill]);

  useEffect(() => {
    if (audioReady) {
      applyAudioVolume();
      applyPlaybackRate(audioRef.current, playbackRate);
    }
  }, [audioReady, volume, isMuted, applyAudioVolume, playbackRate]);

  useEffect(() => {
    applyPlaybackRate(audioRef.current, playbackRate);
    savePlayerPrefs({ ...loadPlayerPrefs(), playbackRate });
  }, [playbackRate]);

  const applyVolume = useCallback(
    (newVolume, options = {}) => {
      const { muted = newVolume === 0, persist = true } = options;
      const clamped = Math.min(100, Math.max(0, newVolume));

      if (clamped > 0) {
        volumeBeforeMuteRef.current = clamped;
      }

      volumeRef.current = clamped;
      isMutedRef.current = muted;

      setVolume(clamped);
      setIsMuted(muted);
      syncVolumeFill(muted ? 0 : clamped);

      if (audioRef.current) {
        applyAudioVolume();
      }

      if (persist) {
        savePlayerPrefs({
          volume: clamped > 0 ? clamped : volumeBeforeMuteRef.current,
          muted,
        });
      }
    },
    [applyAudioVolume, syncVolumeFill]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handleLoadedMetadata = () => {
      const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : currentTrack?.duration || 0;
      setAudioReady(true);
      applyPlaybackPosition(audio.currentTime || 0, nextDuration);
      applyAudioVolume();
    };

    const handleTimeUpdate = () => {
      applyPlaybackPosition(audio.currentTime, audio.duration || durationRef.current);

      const fadeSeconds = crossfadeSecondsRef.current;
      if (
        !fadeSeconds
        || !allowCrossfadeRef.current
        || repeatModeLocalRef.current === 'one'
        || crossfadeLockRef.current
        || isLoadingRef.current
      ) {
        return;
      }

      const total = audio.duration || durationRef.current;
      if (!Number.isFinite(total) || total <= fadeSeconds + 0.4) return;
      const remaining = total - audio.currentTime;
      if (remaining > fadeSeconds) return;

      crossfadeLockRef.current = true;
      shouldFadeInRef.current = true;
      animateFade(fadeGainRef.current, 0, Math.max(180, remaining * 1000), () => {
        skipEndedRef.current = true;
        try {
          audio.pause();
        } catch {
          // ignore
        }
        if (!onTrackFinishRef.current?.()) {
          shouldFadeInRef.current = false;
          fadeGainRef.current = 1;
          applyAudioVolume();
          setIsPlaying(false);
        }
      });
    };

    const handlePlay = () => {
      if (isLoadingRef.current) return;
      setIsPlaying(true);
      if (!eqReadyRef.current) {
        ensureAudioGraph();
      }
    };
    const handlePause = () => {
      if (isLoadingRef.current || crossfadeLockRef.current) return;
      setIsPlaying(false);
    };

    const handleEnded = () => {
      if (skipEndedRef.current) {
        skipEndedRef.current = false;
        return;
      }
      if (crossfadeLockRef.current) return;
      if (onTrackFinishRef.current?.()) return;
      setIsPlaying(false);
    };

    const handleError = () => {
      if (isLoadingRef.current) return;
      const src = String(audio.currentSrc || audio.src || '');
      if (!src) return;
      if (!streamRetryRef.current && currentTrack?.id) {
        streamRetryRef.current = true;
        reloadStream(true);
        return;
      }
      streamRetryRef.current = false;
      isLoadingRef.current = false;
      setAudioReady(false);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [animateFade, applyAudioVolume, applyPlaybackPosition, audioEpoch, currentTrack?.duration, currentTrack?.id, ensureAudioGraph, reloadStream, setIsPlaying]);

  useEffect(() => {
    const pending = pendingStreamRef.current;
    if (!pending?.track?.id) return;
    pendingStreamRef.current = null;
    attachStreamRef.current?.(pending.track, { refresh: Boolean(pending.refresh) });
  }, [audioEpoch]);

  useEffect(() => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track?.id) {
      return undefined;
    }

    const trackId = String(track.id);
    loadedTrackIdRef.current = trackId;
    streamRetryRef.current = false;
    lastProgressStateAtRef.current = 0;
    crossfadeLockRef.current = false;
    skipEndedRef.current = false;
    stopFade();
    if (shouldFadeInRef.current && crossfadeSecondsRef.current > 0) {
      fadeGainRef.current = 0;
    } else {
      shouldFadeInRef.current = false;
      fadeGainRef.current = 1;
    }
    applyAudioVolume();

    const fallbackDuration = Number(track.duration) || 0;
    durationRef.current = fallbackDuration;
    setDuration(fallbackDuration);
    applyPlaybackPosition(0, fallbackDuration);

    attachStreamRef.current?.(track);

    return () => {
      playAttemptRef.current += 1;
      attachGenerationRef.current += 1;
      isLoadingRef.current = true;
      destroyHls(hlsRef);
      haltMediaElement(audioRef.current);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [currentTrack?.id]);

  useEffect(() => () => {
    resetWebAudio();
  }, [resetWebAudio]);

  useEffect(() => {
    let cancelled = false;
    setOfflineState('idle');
    if (!currentTrack?.id) return undefined;
    hasCachedTrack(currentTrack.id)
      .then((cached) => {
        if (!cancelled) setOfflineState(cached ? 'saved' : 'idle');
      })
      .catch(() => {
        if (!cancelled) setOfflineState('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  const handleToggleOffline = useCallback(async () => {
    if (!currentTrack?.id || offlineState === 'saving') return;
    if (offlineState === 'saved') {
      try {
        await removeCachedTrack(currentTrack.id);
        setOfflineState('idle');
      } catch {
        setOfflineState('error');
      }
      return;
    }
    setOfflineState('saving');
    try {
      await saveTrackOffline(currentTrack);
      setOfflineState('saved');
    } catch (error) {
      setOfflineState(error?.message === 'hls' ? 'hls' : 'error');
    }
  }, [currentTrack, offlineState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.id || isLoadingRef.current) {
      return;
    }

    if (isPlaying) {
      if (!audio.currentSrc && !audio.src) {
        attachStreamRef.current?.(currentTrackRef.current);
        return;
      }
      playAudio();
    } else {
      playAttemptRef.current += 1;
      audio.pause();
    }
  }, [isPlaying, playAudio, currentTrack?.id]);

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audio.currentTime = newTime;
    lastProgressStateAtRef.current = 0;
    applyPlaybackPosition(newTime, duration);
  };

  const handleVolumeInput = (e) => {
    applyVolume(parseInt(e.target.value, 10));
  };

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMutedRef.current) {
      applyVolume(volumeBeforeMuteRef.current || volumeRef.current || 100, { muted: false });
    } else {
      volumeBeforeMuteRef.current = volumeRef.current || volumeBeforeMuteRef.current || 100;
      isMutedRef.current = true;
      setIsMuted(true);
      applyAudioVolume();
      savePlayerPrefs({ volume: volumeBeforeMuteRef.current, muted: true });
    }
  }, [applyVolume, applyAudioVolume]);

  useImperativeHandle(
    ref,
    () => ({
      volumeUp(step = 5) {
        const current = isMutedRef.current
          ? volumeBeforeMuteRef.current || volumeRef.current || 100
          : volumeRef.current;
        applyVolume(current + step, { muted: false });
      },
      volumeDown(step = 5) {
        const current = isMutedRef.current
          ? volumeBeforeMuteRef.current || volumeRef.current || 100
          : volumeRef.current;
        applyVolume(current - step, { muted: false });
      },
      toggleMute,
      seekTo(time) {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = time;
        lastProgressStateAtRef.current = 0;
        applyPlaybackPosition(time, durationRef.current);
      },
      getCurrentTime() {
        return audioRef.current?.currentTime || 0;
      },
      openEqualizer() {
        setEqOpen(true);
      },
    }),
    [applyVolume, toggleMute, applyPlaybackPosition]
  );

  const handlePlaybackRate = (rate) => {
    const next = normalizePlaybackRate(rate);
    setPlaybackRate(next);
    applyPlaybackRate(audioRef.current, next);
  };

  const handleEqPreset = (presetId, gains) => {
    setEqPreset(presetId);
    setEqGains(normalizeEqGains(gains));
  };

  const handleEqGains = (gains, preset = 'custom') => {
    setEqPreset(preset);
    setEqGains(normalizeEqGains(gains));
  };

  useEffect(() => {
    if (!sleepEndsAt) return undefined;
    setSleepNow(Date.now());
    const timer = window.setInterval(() => setSleepNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sleepEndsAt]);

  const sleepRemainingMs = sleepEndsAt ? Math.max(0, sleepEndsAt - sleepNow) : 0;
  const sleepLabel = sleepRemainingMs > 0
    ? `${Math.floor(sleepRemainingMs / 60000)}:${String(Math.floor((sleepRemainingMs % 60000) / 1000)).padStart(2, '0')}`
    : '';

  useLayoutEffect(() => {
    if (!moreMenuOpen || !moreMenuButtonRef.current) {
      setMoreMenuStyle(null);
      return undefined;
    }

    const place = () => {
      const rect = moreMenuButtonRef.current.getBoundingClientRect();
      setMoreMenuStyle({
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - 220),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        zIndex: 2147483000,
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (
        moreMenuButtonRef.current?.contains(target)
        || moreMenuRef.current?.contains(target)
        || target.closest?.('.player-speed-menu')
      ) return;
      setMoreMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (queueOpen) setMoreMenuOpen(false);
  }, [queueOpen]);

  const handleSeekTime = (newTime) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = newTime;
    lastProgressStateAtRef.current = 0;
    applyPlaybackPosition(newTime, duration);
  };

  return (
    <>
    <audio key={audioEpoch} ref={audioRef} className="player-audio-engine" preload="metadata" />

    <div className="player-shell">
    <div className={`player player--mini${isPlaying ? ' is-playing' : ''}`}>
      <div className="player-content">
        <div className="player-row player-row-main">
          <div className="player-track-info">
            <button
              type="button"
              className="player-track-cover"
              onClick={handleOpenLyrics}
              aria-label={t('openLyrics')}
            >
              <img
                src={resolveCoverUrl(currentTrack.cover)}
                alt={currentTrack.title}
                onError={(e) => {
                  e.currentTarget.src = FALLBACK_COVER;
                }}
              />
            </button>
            <div className="player-track-details">
              <div className="player-track-title">{currentTrack.title}</div>
              <button
                type="button"
                className="player-track-artist artist-link"
                onClick={() => onOpenArtist?.(currentTrack)}
              >
                {currentTrack.artist}
              </button>
            </div>
            <AddToPlaylistMenu
              track={currentTrack}
              userPlaylists={userPlaylists}
              onAddToPlaylist={onAddToPlaylist}
              onCreatePlaylist={onCreatePlaylist}
              compact
            />
            <button className="like-button" type="button" onClick={onToggleLike}>
              {isLiked ? <FaHeart className="liked" /> : <FaRegHeart />}
            </button>
          </div>

          <div className="player-controls">
            <button
              className="control-button"
              type="button"
              aria-label={t('playerPrevious') || 'Previous'}
              onClick={onPrevious}
            >
              <FaStepBackward />
            </button>
            <button
              className="control-button play-button"
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? (t('playerPause') || 'Pause') : (t('playerPlay') || 'Play')}
            >
              {isPlaying ? <FaPause /> : <FaPlay />}
            </button>
            <button
              className="control-button"
              type="button"
              aria-label={t('playerNext') || 'Next'}
              onClick={onNext}
            >
              <FaStepForward />
            </button>

            <div className="player-more">
              <button
                ref={moreMenuButtonRef}
                className={`control-button player-more-button${moreMenuOpen ? ' is-active' : ''}${shuffleEnabled || repeatMode !== 'off' || queueOpen ? ' has-active-extra' : ''}`}
                type="button"
                aria-label={t('playerMore')}
                title={t('playerMore')}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                onClick={() => setMoreMenuOpen((prev) => !prev)}
              >
                <FaEllipsisH />
                {userQueue.length > 0 && (
                  <span className="player-queue-badge">{userQueue.length}</span>
                )}
              </button>
              {moreMenuOpen && moreMenuStyle
                ? createPortal(
                  <div
                    ref={moreMenuRef}
                    className="player-more-menu"
                    role="menu"
                    aria-label={t('playerMore')}
                    style={moreMenuStyle}
                  >
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={shuffleEnabled}
                      className={shuffleEnabled ? 'is-active' : ''}
                      onClick={() => {
                        onToggleShuffle?.();
                      }}
                    >
                      <FaRandom aria-hidden="true" />
                      <span>{t('playerShuffle')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={repeatMode !== 'off'}
                      className={`${repeatMode !== 'off' ? 'is-active' : ''}${repeatMode === 'one' ? ' is-repeat-one' : ''}`}
                      onClick={() => {
                        onToggleRepeat?.();
                      }}
                    >
                      <FaRedo aria-hidden="true" />
                      <span>{t('playerRepeat')}{repeatMode === 'one' ? ' · 1' : repeatMode === 'all' ? ' · ∞' : ''}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={queueOpen}
                      className={queueOpen ? 'is-active' : ''}
                      onClick={() => {
                        setQueueOpen((prev) => !prev);
                        setMoreMenuOpen(false);
                      }}
                    >
                      <FaList aria-hidden="true" />
                      <span>{t('queueTitle')}</span>
                      {userQueue.length > 0 ? (
                        <span className="player-more-menu-badge">{userQueue.length}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onEnterMini?.();
                      }}
                    >
                      <FaCompress aria-hidden="true" />
                      <span>{t('playerMini')}</span>
                    </button>
                    <div className="player-more-menu-speed">
                      <span className="player-more-menu-label">{t('playerSpeed')}</span>
                      <PlayerSpeedControl rate={playbackRate} onChange={handlePlaybackRate} t={t} />
                    </div>
                    <TrackDownloadButton
                      track={currentTrack}
                      className="player-more-menu-download"
                      labelText={t('playerDownload')}
                      titleFor={(state, progress) => {
                        if (state === 'downloading') return `${t('playerDownload')} ${Math.round((progress || 0) * 100)}%`;
                        if (state === 'done') return t('playerDownloadDone');
                        if (state === 'error') return t('playerDownloadError');
                        return t('playerDownload');
                      }}
                    />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setEqOpen(true);
                      }}
                    >
                      <FaSlidersH aria-hidden="true" />
                      <span>{t('playerEqualizer')}</span>
                    </button>
                  </div>,
                  document.body,
                )
                : null}
            </div>
          </div>

          <div className="player-volume">
            {sleepLabel ? (
              <span className="player-sleep-chip" title={t('settingsSleepTimer')}>
                <FaMoon aria-hidden="true" />
                {sleepLabel}
              </span>
            ) : null}
            <button className="control-button" type="button" onClick={toggleMute} aria-label="Mute">
              {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
            </button>
            <div className="volume-slider-wrap">
              <div className="volume-slider-track" aria-hidden="true">
                <div ref={volumeFillRef} className="volume-slider-fill" style={{ width: `${isMuted ? 0 : volume}%` }} />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={isMuted ? 0 : volume}
                onInput={handleVolumeInput}
                onChange={handleVolumeInput}
                className="volume-slider-input"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>

        <div className="player-row player-row-progress">
          <span className="time">{formatTime(currentTime)}</span>
          <div className="progress-bar" onClick={handleSeek}>
            <div
              ref={playerProgressFillRef}
              className="progress-fill"
              style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
            >
              <div className="progress-handle" />
            </div>
          </div>
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>
    </div>

    <PlayQueue
      open={queueOpen}
      onClose={() => setQueueOpen(false)}
      currentTrack={currentTrack}
      userQueue={userQueue}
      onRemove={onRemoveFromQueue}
      onClear={onClearQueue}
      onMove={onMoveInQueue}
      onPlay={onPlayQueuedTrack}
    />
    </div>

    <NowPlayingOverlay
      isOpen={lyricsOpen}
      onClose={handleCloseLyrics}
      coverOrigin={coverOrigin}
      track={currentTrack}
      isPlaying={isPlaying}
      setIsPlaying={setIsPlaying}
      currentTime={currentTime}
      duration={duration}
      progressFillRef={overlayProgressFillRef}
      onSeek={handleSeekTime}
      onPrevious={onPrevious}
      onNext={onNext}
      isLiked={isLiked}
      onToggleLike={onToggleLike}
      onOpenArtist={onOpenArtist}
      shuffleEnabled={shuffleEnabled}
      onToggleShuffle={onToggleShuffle}
      repeatMode={repeatMode}
      onToggleRepeat={onToggleRepeat}
      offlineState={offlineState}
      onToggleOffline={handleToggleOffline}
    />

    <PlayerEqualizer
      open={eqOpen}
      onClose={() => setEqOpen(false)}
      gains={eqGains}
      preset={eqPreset}
      onChangeGains={handleEqGains}
      onChangePreset={handleEqPreset}
      t={t}
    />
    </>
  );
}

export default forwardRef(Player);
