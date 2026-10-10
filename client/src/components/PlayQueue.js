import React from 'react';
import { FaTimes, FaArrowUp, FaArrowDown, FaTrash } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';
import './PlayQueue.css';

function PlayQueue({
  open,
  onClose,
  currentTrack,
  userQueue,
  onRemove,
  onClear,
  onMove,
  onPlay,
}) {
  const { t } = useLanguage();

  if (!open) return null;

  return (
    <div className="play-queue">
      <div className="play-queue-head">
        <div>
          <strong>{t('queueTitle')}</strong>
          <span>{t('queueDesc')}</span>
        </div>
        <div className="play-queue-head-actions">
          {userQueue.length > 0 && (
            <button type="button" onClick={onClear} title={t('queueClear')}>
              <FaTrash />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t('closeLyrics')}>
            <FaTimes />
          </button>
        </div>
      </div>

      {currentTrack && (
        <button
          type="button"
          className="play-queue-row play-queue-row--now"
          onClick={() => onPlay?.(currentTrack)}
        >
          <img
            src={resolveCoverUrl(currentTrack.coverThumb || currentTrack.cover, FALLBACK_COVER)}
            alt=""
            referrerPolicy="no-referrer"
          />
          <div>
            <em>{t('queueNow')}</em>
            <strong>{currentTrack.title}</strong>
            <span>{currentTrack.artist}</span>
          </div>
        </button>
      )}

      {userQueue.length === 0 ? (
        <p className="play-queue-empty">{t('queueEmpty')}</p>
      ) : (
        <ul className="play-queue-list">
          {userQueue.map((track, index) => (
            <li key={`${track.id}-${index}`} className="play-queue-row">
              <img
                src={resolveCoverUrl(track.coverThumb || track.cover, FALLBACK_COVER)}
                alt=""
                referrerPolicy="no-referrer"
              />
              <button type="button" className="play-queue-meta" onClick={() => onPlay?.(track, true)}>
                <strong>{track.title}</strong>
                <span>{track.artist}</span>
              </button>
              <div className="play-queue-row-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                  aria-label={t('queueMoveUp')}
                >
                  <FaArrowUp />
                </button>
                <button
                  type="button"
                  disabled={index === userQueue.length - 1}
                  onClick={() => onMove(index, 1)}
                  aria-label={t('queueMoveDown')}
                >
                  <FaArrowDown />
                </button>
                <button type="button" onClick={() => onRemove(track.id)} aria-label={t('queueRemove')}>
                  <FaTimes />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PlayQueue;
