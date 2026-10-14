import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  FaPlay,
  FaPause,
  FaStepBackward,
  FaStepForward,
  FaRandom,
  FaRedo,
  FaHeart,
  FaRegHeart,
  FaTimes,
  FaDownload,
} from 'react-icons/fa';
import LyricLine from './LyricLine';
import TrackComments from './TrackComments';
import { useLanguage } from '../context/LanguageContext';
import { cachedRequest } from '../utils/apiCache';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';
import {
  getActiveLineIndex,
  parseLrc,
  plainTextToLines,
} from '../utils/lyrics';
import './NowPlayingOverlay.css';

function buildLyricsCacheKey(track) {
  return `lyrics:${track.id}:${track.title}:${track.artist}`;
}

function fetchLyrics(track) {
  return axios
    .get('/api/lyrics', {
      params: {
        title: track.title,
        artist: track.artist,
        duration: track.duration || undefined,
      },
    })
    .then((res) => res.data);
}

function applyLyricsPayload(payload) {
  return {
    syncedLines: parseLrc(payload?.synced),
    plainLines: plainTextToLines(payload?.plain),
  };
}

function NowPlayingOverlay({
  isOpen,
  onClose,
  coverOrigin,
  track,
  isPlaying,
  setIsPlaying,
  currentTime,
  duration,
  onSeek,
  onPrevious,
  onNext,
  isLiked,
  onToggleLike,
  onOpenArtist,
  progressFillRef,
  shuffleEnabled = false,
  onToggleShuffle,
  repeatMode = 'off',
  onToggleRepeat,
  offlineState = 'idle',
  onToggleOffline,
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [loadedTrackId, setLoadedTrackId] = useState(null);
  const [syncedLines, setSyncedLines] = useState([]);
  const [plainLines, setPlainLines] = useState([]);
  const lyricsRef = useRef(null);
  const lyricsViewportRef = useRef(null);
  const lineRefs = useRef([]);
  const artWrapRef = useRef(null);
  const prevActiveIndexRef = useRef(-1);
  const lyricsMemoryRef = useRef(new Map());
  const [coverAnimStyle, setCoverAnimStyle] = useState(null);
  const [lyricsTrackY, setLyricsTrackY] = useState(0);
  const [lyricsSlideDir, setLyricsSlideDir] = useState('none');

  const coverUrl = resolveCoverUrl(track?.cover);
  const trackKey = track
    ? `${track.id}:${track.title}:${track.artist}:${track.duration || ''}`
    : '';
  const trackId = track?.id;
  const lyricsReady = loadedTrackId === trackId;
  const hasLyrics = syncedLines.length > 0 || plainLines.length > 0;
  const showLyricsColumn = hasLyrics && lyricsReady;
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const displayLines = useMemo(() => {
    if (!lyricsReady) return [];
    if (syncedLines.length) return syncedLines;
    return plainLines.map((text, index) => ({ time: index, text, plain: true }));
  }, [lyricsReady, syncedLines, plainLines]);

  const activeIndex = useMemo(() => {
    if (!lyricsReady || !syncedLines.length) return -1;
    // Plain lyrics have no timestamps. Do not invent a fake timeline by
    // distributing lines evenly across the song duration.
    return getActiveLineIndex(syncedLines, currentTime);
  }, [syncedLines, currentTime, lyricsReady]);

  const getLyricState = (index) => {
    if (!syncedLines.length) return 'plain';
    if (activeIndex < 0) return 'upcoming';
    if (index === activeIndex) return 'active';
    if (index > activeIndex) return 'upcoming';
    return 'past';
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.classList.add('now-playing-open');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('now-playing-open');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !track?.id) return undefined;

    const currentTrackId = track.id;
    const memoryKey = buildLyricsCacheKey(track);
    const remembered = lyricsMemoryRef.current.get(memoryKey);

    if (remembered) {
      setLoadedTrackId(currentTrackId);
      setSyncedLines(remembered.syncedLines);
      setPlainLines(remembered.plainLines);
      setLoading(false);
      return undefined;
    }

    setLoadedTrackId(null);
    setSyncedLines([]);
    setPlainLines([]);
    let cancelled = false;
    setLoading(true);

    cachedRequest(() => fetchLyrics(track), memoryKey, 30 * 60 * 1000)
      .then((data) => {
        if (cancelled) return;
        const parsed = applyLyricsPayload(data);
        lyricsMemoryRef.current.set(memoryKey, parsed);
        setLoadedTrackId(currentTrackId);
        setSyncedLines(parsed.syncedLines);
        setPlainLines(parsed.plainLines);
      })
      .catch(() => {
        if (cancelled) return;
        const empty = { syncedLines: [], plainLines: [] };
        lyricsMemoryRef.current.set(memoryKey, empty);
        setLoadedTrackId(currentTrackId);
        setSyncedLines([]);
        setPlainLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trackKey]);

  useLayoutEffect(() => {
    lineRefs.current = [];
    setLyricsTrackY(0);
    setLyricsSlideDir('none');
  }, [trackId, displayLines.length]);

  useLayoutEffect(() => {
    if (!isOpen || !showLyricsColumn || activeIndex < 0) return undefined;

    const prevIndex = prevActiveIndexRef.current;
    if (prevIndex >= 0 && prevIndex !== activeIndex) {
      setLyricsSlideDir(activeIndex > prevIndex ? 'down' : 'up');
    }

    const measure = () => {
      const viewport = lyricsViewportRef.current;
      const line = lineRefs.current[activeIndex];
      if (!viewport || !line) return;

      const viewportCenter = viewport.clientHeight / 2;
      const lineCenter = line.offsetTop + line.offsetHeight / 2;
      setLyricsTrackY(viewportCenter - lineCenter);
    };

    measure();
    const frame = window.requestAnimationFrame(measure);
    prevActiveIndexRef.current = activeIndex;
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, showLyricsColumn, activeIndex, displayLines, lyricsReady]);

  useEffect(() => {
    prevActiveIndexRef.current = -1;
  }, [trackId]);

  useLayoutEffect(() => {
    if (!isOpen || !coverOrigin) {
      setCoverAnimStyle(null);
      return;
    }

    const art = artWrapRef.current;
    if (!art) return;

    const rect = art.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    setCoverAnimStyle({
      '--cover-from-x': `${coverOrigin.x - centerX}px`,
      '--cover-from-y': `${coverOrigin.y - centerY}px`,
      '--cover-from-scale': `${coverOrigin.size / rect.width}`,
    });
  }, [isOpen, coverOrigin]);

  const formatTime = (time) => {
    if (!Number.isFinite(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (event) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    onSeek?.(percent * duration);
  };

  if (!isOpen || !track) return null;

  return createPortal(
    <div className="now-playing-overlay" role="dialog" aria-modal="true" aria-label={track.title}>
      <div
        className="now-playing-backdrop"
        style={{ backgroundImage: `url(${coverUrl})` }}
        aria-hidden="true"
      />
      <div className="now-playing-scrim" aria-hidden="true" />

      <button type="button" className="now-playing-close" onClick={onClose} aria-label={t('closeLyrics')}>
        <FaTimes />
      </button>

      <div className={`now-playing-layout${showLyricsColumn ? '' : ' now-playing-layout--solo'}`}>
        <section className="now-playing-panel now-playing-panel--meta">
          <div
            ref={artWrapRef}
            className={`now-playing-art-wrap${coverAnimStyle ? ' now-playing-art-wrap--from-cover' : ''}`}
            style={coverAnimStyle || undefined}
          >
            <img
              src={coverUrl}
              alt=""
              className="now-playing-art"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.src = FALLBACK_COVER;
              }}
            />
            <button
              type="button"
              className={`now-playing-like${isLiked ? ' is-liked' : ''}`}
              onClick={onToggleLike}
              aria-label={isLiked ? t('unlikeTrack') : t('likeTrack')}
            >
              {isLiked ? <FaHeart /> : <FaRegHeart />}
            </button>
            {onToggleOffline && (
              <button
                type="button"
                className={`now-playing-offline${offlineState === 'saved' ? ' is-saved' : ''}`}
                onClick={onToggleOffline}
                disabled={offlineState === 'saving'}
                title={
                  offlineState === 'saved'
                    ? t('offlineRemove')
                    : offlineState === 'hls'
                      ? t('offlineHls')
                      : offlineState === 'error'
                        ? t('offlineError')
                        : t('offlineSave')
                }
              >
                <FaDownload />
              </button>
            )}
          </div>

          <div className="now-playing-meta">
            <h2 className="now-playing-title">{track.title}</h2>
            <button
              type="button"
              className="now-playing-artist artist-link"
              onClick={() => onOpenArtist?.(track)}
            >
              {track.artist}
            </button>
          </div>

          <div className="now-playing-progress">
            <span className="now-playing-time">{formatTime(currentTime)}</span>
            <div className="now-playing-progress-bar" onClick={handleProgressClick} role="presentation">
              <div
                ref={progressFillRef}
                className="now-playing-progress-fill"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="now-playing-progress-handle" />
              </div>
            </div>
            <span className="now-playing-time">{formatTime(duration)}</span>
          </div>

          <div className="now-playing-controls">
            <button
              type="button"
              className={`now-playing-control${shuffleEnabled ? ' is-active' : ''}`}
              aria-label="Shuffle"
              aria-pressed={shuffleEnabled}
              onClick={onToggleShuffle}
            >
              <FaRandom />
            </button>
            <button type="button" className="now-playing-control" onClick={onPrevious} aria-label="Previous">
              <FaStepBackward />
            </button>
            <button
              type="button"
              className="now-playing-control now-playing-control--play"
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <FaPause /> : <FaPlay />}
            </button>
            <button type="button" className="now-playing-control" onClick={onNext} aria-label="Next">
              <FaStepForward />
            </button>
            <button
              type="button"
              className={`now-playing-control${repeatMode !== 'off' ? ' is-active' : ''}${repeatMode === 'one' ? ' is-repeat-one' : ''}`}
              aria-label="Repeat"
              aria-pressed={repeatMode !== 'off'}
              onClick={onToggleRepeat}
            >
              <FaRedo />
            </button>
          </div>

          {track?.id ? <TrackComments trackId={track.id} /> : null}

          {!showLyricsColumn && loading && (
            <p className="now-playing-solo-state">{t('lyricsLoading')}</p>
          )}

          {!showLyricsColumn && lyricsReady && !hasLyrics && (
            <p className="now-playing-solo-state">{t('lyricsNotFound')}</p>
          )}
        </section>

        {showLyricsColumn && (
          <section className="now-playing-panel now-playing-panel--lyrics" ref={lyricsRef}>
            <div className="now-playing-lyrics-viewport" ref={lyricsViewportRef}>
              <div
                className={`now-playing-lyrics-track${lyricsSlideDir !== 'none' ? ` now-playing-lyrics-track--${lyricsSlideDir}` : ''}`}
                style={{ transform: `translate3d(0, ${lyricsTrackY}px, 0)` }}
              >
                {displayLines.map((line, index) => {
                  const state = getLyricState(index);
                  const distance = activeIndex < 0 ? Math.max(1, index) : Math.abs(index - activeIndex);
                  return (
                    <LyricLine
                      key={`${trackId}-${index}`}
                      text={line.text}
                      state={state}
                      distance={distance}
                      lineRef={(element) => {
                        lineRefs.current[index] = element;
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>,
    document.body
  );
}

export default NowPlayingOverlay;
