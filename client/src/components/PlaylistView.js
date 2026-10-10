import React, { useState, useEffect } from 'react';
import ScPlaylistView, { ScPlaylistHeaderActions } from './ScPlaylistView';
import { FaSave, FaTimes } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';

function PlaylistView({
  playlist,
  isEditable,
  onUpdate,
  onDelete,
  onRemoveTrack,
  onReorderTracks,
  currentTrack,
  isPlaying,
  playTrack,
  playbackPlaylistId,
  toggleLike,
  isTrackLiked,
  userPlaylists,
  onAddToPlaylist,
  onCreatePlaylist,
  onOpenArtist,
  ownerName,
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description || '');
  const [cover, setCover] = useState(playlist.cover || '');

  useEffect(() => {
    setName(playlist.name);
    setDescription(playlist.description || '');
    setCover(playlist.cover || '');
    setEditing(false);
  }, [playlist]);

  const handleSave = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onUpdate(playlist.id, {
      name: name.trim(),
      description: description.trim(),
      cover: cover.trim() || playlist.cover,
    });
    setEditing(false);
  };

  const tracks = playlist.tracks || [];
  const subtitle = ownerName || t('profileNav');

  return (
    <>
      <ScPlaylistView
        playlist={{
          ...playlist,
          cover: editing ? cover || playlist.cover : playlist.cover,
        }}
        tracks={tracks}
        subtitle={subtitle}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        playTrack={playTrack}
        playbackId={playlist.id}
        playbackPlaylistId={playbackPlaylistId}
        toggleLike={toggleLike}
        isTrackLiked={isTrackLiked}
        userPlaylists={userPlaylists}
        onAddToPlaylist={onAddToPlaylist}
        onCreatePlaylist={onCreatePlaylist}
        onRemoveFromPlaylist={
          isEditable ? (track) => onRemoveTrack(playlist.id, track.id) : undefined
        }
        onOpenArtist={onOpenArtist}
        reorderable={isEditable}
        onReorder={(from, to) => onReorderTracks?.(playlist.id, from, to)}
        headerActions={
          isEditable ? (
            <ScPlaylistHeaderActions
              onEdit={() => setEditing(true)}
              onDelete={() => onDelete(playlist.id)}
              t={t}
            />
          ) : null
        }
        t={t}
      />

      {editing && (
        <div className="sc-pl-edit-overlay" onClick={() => setEditing(false)}>
          <form
            className="sc-pl-edit-modal glass-shine"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSave}
          >
            <h3>{t('editPlaylist')}</h3>
            <label>{t('playlistName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <label>{t('playlistDescription')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            <label>{t('playlistCover')}</label>
            <input
              type="url"
              value={cover}
              onChange={(e) => setCover(e.target.value)}
            />
            <div className="sc-pl-edit-actions">
              <button type="button" onClick={() => setEditing(false)}>
                <FaTimes /> {t('cancel')}
              </button>
              <button type="submit" className="primary">
                <FaSave /> {t('saveChanges')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export default PlaylistView;
