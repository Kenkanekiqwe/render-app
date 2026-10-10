import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus, FaTimes, FaList, FaForward, FaBroadcastTower } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { usePlaybackExtras } from '../context/PlaybackExtrasContext';

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

function AddToPlaylistMenu({
  track,
  userPlaylists,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreatePlaylist,
  compact = false,
}) {
  const { t } = useLanguage();
  const { addToQueue, playNext, playRadio } = usePlaybackExtras();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const buttonRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuStyle(null);
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < MENU_MAX_HEIGHT + 12 && spaceAbove > spaceBelow;

      let left = rect.right - MENU_WIDTH;
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));

      let top;
      let transform;
      if (openUp) {
        top = rect.top - 8;
        transform = 'translateY(-100%)';
      } else {
        top = rect.bottom + 8;
        transform = 'none';
      }

      setMenuStyle({ left, top, transform });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  if (!onAddToPlaylist && !onRemoveFromPlaylist && !addToQueue && !playNext && !playRadio) return null;

  const menu = open && menuStyle && (
    <>
      <div
        className="track-menu-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
        }}
      />
      <div
        className="track-menu track-menu-portal"
        style={{
          position: 'fixed',
          left: menuStyle.left,
          top: menuStyle.top,
          transform: menuStyle.transform,
          width: MENU_WIDTH,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {playNext && (
          <button
            type="button"
            className="track-menu-item"
            onClick={() => {
              playNext(track);
              setOpen(false);
            }}
          >
            <FaForward /> {t('queuePlayNext')}
          </button>
        )}
        {addToQueue && (
          <button
            type="button"
            className="track-menu-item"
            onClick={() => {
              addToQueue(track);
              setOpen(false);
            }}
          >
            <FaList /> {t('queueAdd')}
          </button>
        )}
        {playRadio && (
          <button
            type="button"
            className="track-menu-item"
            onClick={() => {
              playRadio(track);
              setOpen(false);
            }}
          >
            <FaBroadcastTower /> {t('radioFromTrack')}
          </button>
        )}
        {onRemoveFromPlaylist && (
          <button
            type="button"
            className="track-menu-item danger"
            onClick={() => {
              onRemoveFromPlaylist(track);
              setOpen(false);
            }}
          >
            <FaTimes /> {t('removeFromPlaylist')}
          </button>
        )}
        {onAddToPlaylist && (userPlaylists?.length > 0 ? (
          userPlaylists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className="track-menu-item"
              onClick={() => {
                onAddToPlaylist(playlist.id, track);
                setOpen(false);
              }}
            >
              {playlist.name}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="track-menu-item"
            onClick={() => {
              onCreatePlaylist?.();
              setOpen(false);
            }}
          >
            + {t('createPlaylist')}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className={`add-playlist-menu${compact ? ' compact' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`track-menu-btn${open ? ' active' : ''}`}
        title={t('addToPlaylist')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <FaPlus />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

export default AddToPlaylistMenu;
