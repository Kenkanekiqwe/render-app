import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes } from 'react-icons/fa';
import { EQ_BANDS, EQ_PRESETS } from '../utils/equalizer';
import './PlayerEqualizer.css';

function PlayerEqualizer({
  open,
  onClose,
  gains,
  preset,
  onChangeGains,
  onChangePreset,
  t,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="player-eq-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      role="presentation"
    >
      <div className="player-eq-panel" role="dialog" aria-modal="true">
        <div className="player-eq-head">
          <h3>{t('playerEqualizer')}</h3>
          <button type="button" className="player-eq-close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>

        <div className="player-eq-presets">
          {Object.entries(EQ_PRESETS).map(([id, item]) => (
            <button
              key={id}
              type="button"
              className={`player-eq-preset${preset === id ? ' is-active' : ''}`}
              onClick={() => onChangePreset?.(id, item.gains)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="player-eq-sliders">
          {EQ_BANDS.map((band, index) => (
            <label key={band.id} className="player-eq-band">
              <span className="player-eq-gain">{Number(gains[index] || 0).toFixed(1)}</span>
              <span className="player-eq-slider">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={gains[index] ?? 0}
                  onChange={(e) => {
                    const next = [...gains];
                    next[index] = Number(e.target.value);
                    onChangeGains?.(next, 'custom');
                  }}
                  aria-label={band.label}
                />
              </span>
              <span className="player-eq-freq">{band.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default PlayerEqualizer;
