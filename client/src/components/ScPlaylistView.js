import React from 'react';
import './ScPlaylistView.css';
import TrackList from './TrackList';
import { FaArrowLeft, FaMusic, FaPlay, FaPause, FaEdit, FaTrash } from 'react-icons/fa';
import { resolveCoverUrl } from '../utils/tracks';

function formatTotalDuration(tracks) {
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(1, Math.floor(total / 60))}m`;
}

function ScPlaylistView({
  playlist,
  tracks,
  subtitle,
  onBack,
  currentTrack,
  isPlaying,
  playTrack,
  playbackId,
  playbackPlaylistId,
  toggleLike,
  isTrackLiked,
  userPlaylists,
  onAddToPlaylist,
  onCreatePlaylist,
  onRemoveFromPlaylist,
  onOpenArtist,
  reorderable = false,
  onReorder,
  headerActions,
  t,
}) {
  const playlistIsLive =
    playbackPlaylistId === playbackId &&
    isPlaying &&
    currentTrack &&
    tracks.some((track) => track.id === currentTrack.id);

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    if (playlistIsLive) {
      playTrack(currentTrack, tracks, playbackId);
      return;
    }
    playTrack(tracks[0], tracks, playbackId);
  };

  const cover = resolveCoverUrl(playlist.cover);

  return (
    <div className="sc-pl-page">
      <div
        className="sc-pl-bg"
        style={{ backgroundImage: cover ? `url(${cover})` : undefined }}
        aria-hidden="true"
      />

      {onBack && (
        <div className="sc-pl-top">
          <button type="button" className="sc-pl-back" onClick={onBack}>
            <FaArrowLeft />
            <span>{playlist.name}</span>
          </button>
        </div>
      )}

      <div className="sc-pl-hero glass-shine">
        <div className="sc-pl-cover">
          <img src={cover} alt={playlist.name} referrerPolicy="no-referrer" />
        </div>

        <div className="sc-pl-info">
          <h1>{playlist.name}</h1>
          {subtitle && <p className="sc-pl-subtitle">{subtitle}</p>}
          {playlist.description && (
            <p className="sc-pl-description">{playlist.description}</p>
          )}
          <div className="sc-pl-meta">
            <span>
              <FaMusic /> {tracks.length} {t('playlistTracks')}
            </span>
            {tracks.length > 0 && <span>{formatTotalDuration(tracks)}</span>}
          </div>

          <div className="sc-pl-actions">
            {tracks.length > 0 && (
              <button
                type="button"
                className="sc-pl-play-btn"
                data-ui-sound="none"
                onClick={handlePlayAll}
              >
                {playlistIsLive ? <FaPause /> : <FaPlay />}
                {playlistIsLive ? t('wavePause') : t('playAll')}
              </button>
            )}
            {headerActions}
          </div>
        </div>
      </div>

      {tracks.length > 0 ? (
        <>
          {reorderable && (
            <p className="sc-pl-reorder-hint">{t('reorderHint')}</p>
          )}
          <TrackList
            variant="album"
            tracks={tracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={(track) => playTrack(track, tracks, playbackId)}
            toggleLike={toggleLike}
            isTrackLiked={isTrackLiked}
            userPlaylists={userPlaylists}
            onAddToPlaylist={onAddToPlaylist}
            onCreatePlaylist={onCreatePlaylist}
            onRemoveFromPlaylist={onRemoveFromPlaylist}
            onOpenArtist={onOpenArtist}
            reorderable={reorderable}
            onReorder={onReorder}
          />
        </>
      ) : (
        <p className="no-results sc-pl-empty">{t('playlistEmpty')}</p>
      )}
    </div>
  );
}

export function ScPlaylistHeaderActions({ onEdit, onDelete, t }) {
  return (
    <div className="sc-pl-header-actions">
      <button type="button" className="sc-pl-icon-btn" onClick={onEdit}>
        <FaEdit /> {t('editPlaylist')}
      </button>
      <button type="button" className="sc-pl-icon-btn sc-pl-icon-btn--danger" onClick={onDelete}>
        <FaTrash /> {t('deletePlaylist')}
      </button>
    </div>
  );
}

export default ScPlaylistView;
