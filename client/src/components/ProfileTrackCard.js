import React from 'react';
import { FaPlay, FaPause, FaThumbtack } from 'react-icons/fa';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';
import { hydrateProfileTrack } from '../utils/profile';

function ProfileTrackCard({
  track,
  label,
  isPlaying = false,
  isLive = false,
  onPlay,
  onPin,
  onUnpin,
  showPinActions = false,
  variant = 'default',
  t,
}) {
  if (!track) return null;

  const cardClass = [
    'profile-track-card',
    isLive ? 'profile-track-card--live' : '',
    variant === 'inline' ? 'profile-track-card--inline' : '',
    variant === 'mini' ? 'profile-track-card--mini' : '',
  ].filter(Boolean).join(' ');

  if (variant === 'mini') {
    const trackTitle = String(track.title || track.name || '').trim();
    const trackArtist = String(track.artist || '').trim();
    const playableTrack = hydrateProfileTrack(track);
    const trackLine = [trackTitle, trackArtist].filter(Boolean).join(' · ');
    const trackTooltip = trackLine || label;

    const handlePlay = () => {
      if (!playableTrack?.soundcloudUrl) return;
      onPlay?.(playableTrack);
    };

    return (
      <div className={cardClass} title={trackTooltip}>
        <button
          type="button"
          className="profile-track-card-mini-main"
          onClick={handlePlay}
          disabled={!playableTrack?.soundcloudUrl}
          aria-label={trackLine || label}
        >
          <span className="profile-track-card-mini-cover">
            <img
              src={resolveCoverUrl(track.cover)}
              alt=""
              referrerPolicy="no-referrer"
            />
          </span>
          <span className="profile-track-card-mini-text">
            <span className="profile-track-card-mini-label">{label}</span>
            {trackLine ? (
              <span className="profile-track-card-mini-line">{trackLine}</span>
            ) : null}
          </span>
        </button>
        {showPinActions && (
          <div className="profile-track-card-mini-actions">
            {onPin && (
              <button
                type="button"
                className="profile-track-card-mini-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onPin(track);
                }}
                title={t('profilePinTrack')}
              >
                <FaThumbtack />
              </button>
            )}
            {onUnpin && (
              <button
                type="button"
                className="profile-track-card-mini-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onUnpin();
                }}
                title={t('profileUnpinTrack')}
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const playableTrack = hydrateProfileTrack(track);

  return (
    <div className={cardClass}>
      <div className="profile-track-card-cover media-cover-hover">
        <img
          src={resolveCoverUrl(track.cover)}
          alt={track.title}
          referrerPolicy="no-referrer"
        />
        {onPlay && playableTrack?.soundcloudUrl && (
          <button
            type="button"
            className="profile-track-card-play"
            onClick={() => onPlay(playableTrack)}
            aria-label={isLive && isPlaying ? t('wavePause') : t('playAll')}
          >
            {isLive && isPlaying ? <FaPause /> : <FaPlay />}
          </button>
        )}
      </div>
      <div className="profile-track-card-body">
        {label && <span className="profile-track-card-label">{label}</span>}
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>
      {showPinActions && (
        <div className="profile-track-card-actions">
          {onPin && (
            <button type="button" className="profile-track-card-btn" onClick={() => onPin(track)}>
              <FaThumbtack /> {t('profilePinTrack')}
            </button>
          )}
          {onUnpin && (
            <button type="button" className="profile-track-card-btn profile-track-card-btn--ghost" onClick={onUnpin}>
              {t('profileUnpinTrack')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ProfileTrackCard;
