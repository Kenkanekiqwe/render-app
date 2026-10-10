import React, { useEffect, useRef, useState } from 'react';
import { FaPlay, FaPause, FaStepForward, FaExpand } from 'react-icons/fa';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';
import {
  listenMiniPlayerState,
  readMiniPlayerState,
  sendMiniPlayerAction,
} from '../utils/miniPlayer';
import { useLanguage } from '../context/LanguageContext';
import './MiniPlayer.css';

function MiniPlayerView({
  track,
  isPlaying,
  onTogglePlay,
  onNext,
  onExpand,
  floating = false,
}) {
  const { t } = useLanguage();
  const rootRef = useRef(null);
  const [pos, setPos] = useState(null);

  const startOverlayDrag = (event) => {
    if (!floating || event.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;

    const move = (moveEvent) => {
      const left = Math.min(
        window.innerWidth - rect.width,
        Math.max(0, moveEvent.clientX - grabX)
      );
      const top = Math.min(
        window.innerHeight - rect.height,
        Math.max(0, moveEvent.clientY - grabY)
      );
      setPos({ left, top });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const overlayStyle = floating && pos
    ? { left: pos.left, top: pos.top, bottom: 'auto', transform: 'none' }
    : undefined;

  const content = track ? (
    <>
      <div
        className="mini-player-drag"
        data-tauri-drag-region={!floating ? true : undefined}
        onPointerDown={floating ? startOverlayDrag : undefined}
        onDoubleClick={onExpand}
      >
        <div className="mini-player-cover">
          <img
            src={resolveCoverUrl(track.cover)}
            alt=""
            draggable={false}
            onError={(e) => {
              e.currentTarget.src = FALLBACK_COVER;
            }}
          />
        </div>
        <div className="mini-player-meta">
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>
      </div>

      <div className="mini-player-controls">
        <button
          type="button"
          className="mini-player-btn is-play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </button>
        <button
          type="button"
          className="mini-player-btn"
          onClick={onNext}
          aria-label="Next"
        >
          <FaStepForward />
        </button>
        <button
          type="button"
          className="mini-player-btn"
          onClick={onExpand}
          aria-label={t('playerExpand')}
          title={t('playerExpand')}
        >
          <FaExpand />
        </button>
      </div>
    </>
  ) : (
    <div
      className="mini-player-drag"
      data-tauri-drag-region={!floating ? true : undefined}
      onPointerDown={floating ? startOverlayDrag : undefined}
    >
      <div className="mini-player-cover" />
      <div className="mini-player-meta">
        <strong>Render</strong>
        <span>…</span>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`mini-player${floating ? ' is-floating' : ' is-window'}${pos ? ' is-moved' : ''}`}
      style={overlayStyle}
    >
      {content}
    </div>
  );
}

export function MiniPlayerOverlay({ track, isPlaying, onTogglePlay, onNext, onExpand }) {
  return (
    <MiniPlayerView
      track={track}
      isPlaying={isPlaying}
      onTogglePlay={onTogglePlay}
      onNext={onNext}
      onExpand={onExpand}
      floating
    />
  );
}

export function MiniPlayerWindow() {
  const initial = readMiniPlayerState();
  const [state, setState] = useState(() => ({
    track: initial?.track || null,
    isPlaying: Boolean(initial?.isPlaying),
  }));

  useEffect(() => listenMiniPlayerState((next) => {
    setState({
      track: next?.track || null,
      isPlaying: Boolean(next?.isPlaying),
    });
  }), []);

  useEffect(() => {
    document.documentElement.classList.add('mini-player-root');
    document.body.classList.add('mini-player-root');
    return () => {
      document.documentElement.classList.remove('mini-player-root');
      document.body.classList.remove('mini-player-root');
    };
  }, []);

  return (
    <MiniPlayerView
      track={state.track}
      isPlaying={state.isPlaying}
      onTogglePlay={() => sendMiniPlayerAction('toggle')}
      onNext={() => sendMiniPlayerAction('next')}
      onExpand={() => sendMiniPlayerAction('restore')}
    />
  );
}

export default MiniPlayerView;
