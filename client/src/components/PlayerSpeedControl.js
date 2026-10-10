import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PLAYBACK_RATES, formatPlaybackRate } from '../utils/streamPlayback';
import './PlayerSpeedControl.css';

function PlayerSpeedControl({ rate, onChange, t }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setMenuStyle(null);
      return undefined;
    }

    const place = () => {
      const rect = rootRef.current.getBoundingClientRect();
      setMenuStyle({
        position: 'fixed',
        right: Math.max(8, window.innerWidth - rect.right),
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
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // defer so the opening click doesn't instantly close
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="player-speed" ref={rootRef}>
      <button
        type="button"
        className={`player-speed-chip${rate !== 1 ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('playerSpeed') || 'РЎРєРѕСЂРѕСЃС‚СЊ'}
        title={`${t('playerSpeed') || 'РЎРєРѕСЂРѕСЃС‚СЊ'}: ${formatPlaybackRate(rate)}`}
        aria-expanded={open}
      >
        {formatPlaybackRate(rate)}
      </button>
      {open && menuStyle
        ? createPortal(
          <div
            ref={menuRef}
            className="player-speed-menu"
            role="listbox"
            aria-label={t('playerSpeed') || 'РЎРєРѕСЂРѕСЃС‚СЊ'}
            style={menuStyle}
          >
            {PLAYBACK_RATES.map((value) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={rate === value}
                className={rate === value ? 'is-active' : ''}
                onClick={() => {
                  onChange?.(value);
                  setOpen(false);
                }}
              >
                {formatPlaybackRate(value)}
              </button>
            ))}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

export default PlayerSpeedControl;

