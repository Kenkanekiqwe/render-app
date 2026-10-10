import React, { useState, useRef, useCallback, useEffect } from 'react';
import './TrackList.css';
import { FaPlay, FaPause, FaRegHeart, FaHeart, FaGripVertical } from 'react-icons/fa';
import AddToPlaylistMenu from './AddToPlaylistMenu';
import { FALLBACK_COVER, resolveCoverUrl } from '../utils/tracks';

function computeReorderTarget(from, insertBefore) {
  if (insertBefore === from || insertBefore === from + 1) return null;
  let to = insertBefore;
  if (insertBefore > from) to -= 1;
  return to;
}

function TrackList({
  tracks,
  currentTrack,
  isPlaying,
  playTrack,
  toggleLike,
  isTrackLiked,
  userPlaylists,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreatePlaylist,
  onOpenArtist,
  reorderable = false,
  onReorder,
  variant = 'default',
}) {
  const listRef = useRef(null);
  const dragFromRef = useRef(null);
  const dropInsertRef = useRef(null);
  const didDragRef = useRef(false);
  const rafRef = useRef(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dropInsertIndex, setDropInsertIndex] = useState(null);

  const getInsertIndex = useCallback((clientY) => {
    const rows = listRef.current?.querySelectorAll('.track-item');
    if (!rows?.length) return 0;

    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }

    return rows.length;
  }, []);

  const resetDrag = useCallback(() => {
    dragFromRef.current = null;
    dropInsertRef.current = null;
    setDragFrom(null);
    setDropInsertIndex(null);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const finishDrag = useCallback(() => {
    if (dragFromRef.current === null) return;

    const from = dragFromRef.current;
    const insertBefore = dropInsertRef.current ?? from;
    const to = computeReorderTarget(from, insertBefore);

    if (to !== null) {
      onReorder?.(from, to);
    }

    resetDrag();
  }, [onReorder, resetDrag]);

  useEffect(() => {
    if (dragFrom === null) return undefined;

    const handlePointerMove = (event) => {
      if (dragFromRef.current === null) return;
      didDragRef.current = true;

      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const nextInsert = getInsertIndex(event.clientY);
        if (dropInsertRef.current !== nextInsert) {
          dropInsertRef.current = nextInsert;
          setDropInsertIndex(nextInsert);
        }
      });
    };

    const handlePointerUp = () => {
      finishDrag();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        resetDrag();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dragFrom, finishDrag, getInsertIndex, resetDrag]);

  const handleHandlePointerDown = (e, fromIndex) => {
    if (!reorderable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    didDragRef.current = false;
    dragFromRef.current = fromIndex;
    dropInsertRef.current = fromIndex;
    setDragFrom(fromIndex);
    setDropInsertIndex(fromIndex);
  };

  const handleRowClick = (track) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    playTrack(track, tracks);
  };

  return (
    <div
      ref={listRef}
      className={`track-list${reorderable ? ' reorderable' : ''}${dragFrom !== null ? ' is-dragging' : ''}${variant !== 'default' ? ` track-list--${variant}` : ''}`}
    >
      {tracks.map((track, index) => {
        const liked = isTrackLiked ? isTrackLiked(track.id) : false;
        const isCurrent = currentTrack?.id === track.id;
        const isDragging = dragFrom === index;
        const showDropLineBefore = dropInsertIndex === index && dragFrom !== null && !isDragging;

        return (
          <React.Fragment key={track.id}>
            {showDropLineBefore && <div className="track-drop-line" aria-hidden="true" />}
            <div
              className={`track-item${isCurrent ? ' active' : ''}${isCurrent && isPlaying ? ' is-playing' : ''}${isDragging ? ' dragging' : ''}`}
              onClick={() => handleRowClick(track)}
            >
              {reorderable && (
                <div
                  className="track-drag-handle"
                  onPointerDown={(e) => handleHandlePointerDown(e, index)}
                  onClick={(e) => e.stopPropagation()}
                  role="button"
                  tabIndex={0}
                  aria-label="Reorder"
                >
                  <FaGripVertical />
                </div>
              )}

              <div className="track-number">
                {isCurrent && isPlaying ? (
                  <FaPause className="track-icon" />
                ) : (
                  <>
                    <span className="number">{index + 1}</span>
                    <FaPlay className="play-icon" />
                  </>
                )}
              </div>

              <div className="track-info">
                {variant !== 'album' && (
                  <div className="track-cover-wrap media-cover-hover">
                    <img
                      src={resolveCoverUrl(track.coverThumb || track.cover)}
                      alt={track.title}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_COVER;
                      }}
                    />
                  </div>
                )}
                <div className="track-details">
                  <div className="track-title">{track.title}</div>
                  {onOpenArtist ? (
                    <button
                      type="button"
                      className="track-artist artist-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenArtist(track);
                      }}
                    >
                      {track.artist}
                    </button>
                  ) : (
                    <div className="track-artist">{track.artist}</div>
                  )}
                </div>
              </div>

              {variant === 'default' && (
                <div className="track-album">{track.album}</div>
              )}

              {variant === 'default' && (
                <div className="track-actions">
                  <AddToPlaylistMenu
                    track={track}
                    userPlaylists={userPlaylists}
                    onAddToPlaylist={onAddToPlaylist}
                    onRemoveFromPlaylist={onRemoveFromPlaylist}
                    onCreatePlaylist={onCreatePlaylist}
                  />
                  <button
                    type="button"
                    className={`like-btn ${liked ? 'liked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike?.(track);
                    }}
                  >
                    {liked ? <FaHeart /> : <FaRegHeart />}
                  </button>
                </div>
              )}

              {(variant === 'artist' || variant === 'album') && (
                <div className="track-actions track-actions--compact">
                  <AddToPlaylistMenu
                    track={track}
                    userPlaylists={userPlaylists}
                    onAddToPlaylist={onAddToPlaylist}
                    onRemoveFromPlaylist={onRemoveFromPlaylist}
                    onCreatePlaylist={onCreatePlaylist}
                    compact
                  />
                  <button
                    type="button"
                    className={`like-btn ${liked ? 'liked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike?.(track);
                    }}
                  >
                    {liked ? <FaHeart /> : <FaRegHeart />}
                  </button>
                </div>
              )}

              <div className="track-duration">
                {Math.floor(track.duration / 60)}:
                {(track.duration % 60).toString().padStart(2, '0')}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      {dragFrom !== null && dropInsertIndex === tracks.length && (
        <div className="track-drop-line track-drop-line-end" aria-hidden="true" />
      )}
    </div>
  );
}

export default TrackList;
