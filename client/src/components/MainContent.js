import React, { useState, useRef, useEffect } from 'react';
import './MainContent.css';
import './ArtistView.css';
import TrackList from './TrackList';
import PlaylistView from './PlaylistView';
import AddToPlaylistMenu from './AddToPlaylistMenu';
import { FaPlay, FaPause, FaHistory, FaHeart, FaPlus, FaTrash, FaSlidersH, FaFileImport } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import {
  getPersonalizedTracks,
  getTopArtists,
  getWavePreviewCovers,
} from '../utils/recommendations';
import { mergeRecentTracks } from '../utils/storage';
import { filterValidTracks, resolveCoverUrl } from '../utils/tracks';
import WaveThreads from './WaveThreads';

function MainContent({
  tracks,
  history,
  likedTracks,
  playlists,
  userPlaylists,
  activePlaylist,
  currentTrack,
  isPlaying,
  playTrack,
  playWave,
  waveActive,
  onOpenEqualizer,
  playPlaylist,
  playbackPlaylistId,
  toggleLike,
  isTrackLiked,
  currentView,
  searchQuery,
  searchResults,
  searchArtistResults,
  searchRecent,
  onSearch,
  onOpenArtist,
  onOpenArtistFromTrack,
  onNavigate,
  onCreatePlaylist,
  onDeletePlaylist,
  onOpenPlaylist,
  onAddTrackToPlaylist,
  onImportPlaylist,
  onUpdatePlaylist,
  onRemoveTrackFromPlaylist,
  onReorderPlaylistTracks,
  isInitialLoading,
  isSearching,
  profileDisplayName,
}) {
  const { t } = useLanguage();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [newPlaylistCover, setNewPlaylistCover] = useState('');
  const [importPlaylistName, setImportPlaylistName] = useState('');
  const [importPlaylistInput, setImportPlaylistInput] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [waveHint, setWaveHint] = useState('');
  const [waveLinesOpacity, setWaveLinesOpacity] = useState(1);
  const [searchTab, setSearchTab] = useState('tracks');
  const mainContentRef = useRef(null);
  const waveBannerRef = useRef(null);
  const waveFadeRef = useRef(0);

  useEffect(() => {
    if (currentView !== 'home') {
      waveFadeRef.current = 0;
      setWaveLinesOpacity(1);
      return undefined;
    }

    waveFadeRef.current = 0;
    setWaveLinesOpacity(1);

    const scrollEl = mainContentRef.current;
    if (!scrollEl) return undefined;

    const applyFade = () => {
      setWaveLinesOpacity(Math.max(0, 1 - waveFadeRef.current));
    };

    const handleWheel = (e) => {
      const sensitivity = 0.0016;
      if (e.deltaY > 0) {
        waveFadeRef.current = Math.min(1, waveFadeRef.current + e.deltaY * sensitivity);
      } else if (e.deltaY < 0) {
        waveFadeRef.current = Math.max(0, waveFadeRef.current + e.deltaY * sensitivity);
      }
      applyFade();
    };

    const handleScrollTopReset = () => {
      if (scrollEl.scrollTop <= 4) {
        waveFadeRef.current = 0;
        applyFade();
      }
    };

    scrollEl.addEventListener('wheel', handleWheel, { passive: true });
    scrollEl.addEventListener('scroll', handleScrollTopReset, { passive: true });

    return () => {
      scrollEl.removeEventListener('wheel', handleWheel);
      scrollEl.removeEventListener('scroll', handleScrollTopReset);
    };
  }, [currentView]);

  const personalizedTracks = filterValidTracks(
    getPersonalizedTracks(history, likedTracks, tracks, 10)
  );
  const topArtists = filterValidTracks(getTopArtists(history, likedTracks, tracks, 12));
  const waveCovers = getWavePreviewCovers(history, likedTracks, tracks, 5);
  const hasPersonalData = history.length > 0 || likedTracks.length > 0;
  const homeSectionTitle = hasPersonalData ? t('forYou') : t('popular');
  const catalogPlaylists = (playlists || []).filter((playlist) => playlist?.name !== 'SoundCloud Top');
  const searchRecentTracks = filterValidTracks(mergeRecentTracks(history, searchRecent, 24));
  const isSearchActive = Boolean(searchQuery.trim());
  const searchDisplayTracks = isSearchActive ? filterValidTracks(searchResults) : searchRecentTracks;

  const openTrackArtist = onOpenArtistFromTrack || onOpenArtist;

  const isPlaylistLive = (playlist) =>
    playbackPlaylistId === playlist.id &&
    isPlaying &&
    currentTrack &&
    playlist.tracks?.some((track) => track.id === currentTrack.id);

  const openCreateModal = () => setShowCreateModal(true);

  const handlePlayWave = async () => {
    if (waveActive) {
      await playWave();
      setWaveHint('');
      return;
    }
    setWaveHint(t('wavePicking'));
    const started = await playWave();
    setWaveHint(started ? '' : t('waveEmpty'));
  };

  const waveIsLive = waveActive && isPlaying;

  const handleCreate = (e) => {
    e.preventDefault();
    if (newPlaylistName.trim()) {
      onCreatePlaylist({
        name: newPlaylistName.trim(),
        description: newPlaylistDescription.trim(),
        cover: newPlaylistCover.trim(),
      });
      setNewPlaylistName('');
      setNewPlaylistDescription('');
      setNewPlaylistCover('');
      setShowCreateModal(false);
    }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!importPlaylistInput.trim() || isImporting) return;

    setIsImporting(true);
    setImportStatus('');

    try {
      const playlist = await onImportPlaylist({
        name: importPlaylistName.trim(),
        input: importPlaylistInput.trim(),
      });

      setImportPlaylistName('');
      setImportPlaylistInput('');
      setShowImportModal(false);
      setImportStatus('');

      if (!playlist?.tracks?.length) {
        setImportStatus(t('importPlaylistEmpty'));
      }
    } catch (error) {
      setImportStatus(t('importPlaylistError'));
    } finally {
      setIsImporting(false);
    }
  };

  const showPageHeader = !['home', 'search', 'playlist'].includes(currentView);

  return (
    <div className="main-content" ref={mainContentRef}>
      {showPageHeader && (
        <div className="main-header">
          <h2>
            {currentView === 'history' && t('history')}
            {currentView === 'liked' && t('liked')}
            {currentView === 'library' && t('library')}
            {currentView === 'playlist' && activePlaylist?.name}
          </h2>
        </div>
      )}

      <div className="content-body">
        {isInitialLoading && currentView === 'home' && tracks.length === 0 && (
          <p className="loading-message subtle">{t('loadingTracks')}</p>
        )}

        {(!isInitialLoading || currentView !== 'home' || tracks.length > 0) && currentView === 'home' && (
          <>
            <section
              ref={waveBannerRef}
              className={`my-wave-banner glass-shine${waveActive ? ' my-wave-banner--active' : ''}${waveIsLive ? ' my-wave-banner--live' : ''}`}
              aria-label={t('myWave')}
            >
              <WaveThreads
                opacity={waveLinesOpacity}
                isActive={waveActive}
                isLive={waveIsLive}
              />

              <div className="wave-banner-front">
                <button
                  type="button"
                  className={`wave-play-btn${waveActive ? ' is-active' : ''}`}
                  data-ui-sound="none"
                  onClick={handlePlayWave}
                  aria-label={waveIsLive ? t('wavePause') : t('myWave')}
                >
                  {waveIsLive ? <FaPause /> : <FaPlay />}
                </button>
                <div className="wave-banner-text">
                  <div className="wave-title-row">
                    <h3>{t('myWave')}</h3>
                    {waveActive && (
                      <span className={`wave-live-badge${waveIsLive ? ' is-live' : ''}`}>
                        <span className="wave-live-dot" />
                        {waveIsLive ? t('waveRunning') : t('wavePaused')}
                      </span>
                    )}
                  </div>
                  {waveHint && <p className="wave-hint">{waveHint}</p>}
                </div>
                {waveCovers.length > 0 && (
                  <div className="wave-preview-avatars">
                    {waveCovers.map((cover, index) => (
                      <img key={`${cover}-${index}`} src={resolveCoverUrl(cover)} alt="" referrerPolicy="no-referrer" />
                    ))}
                  </div>
                )}
                <button type="button" className="wave-settings-btn" aria-label={t('playerEqualizer')} onClick={onOpenEqualizer}>
                  <FaSlidersH />
                </button>
              </div>
            </section>

            <section className="quick-access-row">
              <button type="button" className="quick-card glass-shine" onClick={() => onNavigate('history')}>
                <div className="quick-card-icon">
                  <FaHistory />
                </div>
                <div className="quick-card-text">
                  <h4>{t('historyTitle')}</h4>
                  <p>{t('historyDesc')}</p>
                </div>
              </button>
              <button type="button" className="quick-card glass-shine" onClick={() => onNavigate('liked')}>
                <div className="quick-card-icon heart">
                  <FaHeart />
                </div>
                <div className="quick-card-text">
                  <h4>{t('likedTitle')}</h4>
                  <p>{t('likedDesc')}</p>
                </div>
              </button>
            </section>

            <section className="popular-section">
              <h3 className="section-title">{homeSectionTitle}</h3>

              <div className="popular-block">
                <h4 className="popular-subtitle">{t('tracks')}</h4>
                <div className="horizontal-scroll hide-scrollbar">
                  {personalizedTracks.map((track) => (
                    <div
                      key={track.id}
                      className="scroll-card track-scroll-card"
                      onClick={() => playTrack(track, personalizedTracks)}
                    >
                      <div className="scroll-card-cover media-cover-hover">
                        <img
                          src={resolveCoverUrl(track.cover)}
                          alt={track.title}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src =
                              'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg';
                          }}
                        />
                        <span className="sc-badge">☁</span>
                        <div className="scroll-card-add" onClick={(e) => e.stopPropagation()}>
                          <AddToPlaylistMenu
                            track={track}
                            userPlaylists={userPlaylists}
                            onAddToPlaylist={onAddTrackToPlaylist}
                            onCreatePlaylist={openCreateModal}
                            compact
                          />
                        </div>
                      </div>
                      <p className="scroll-card-title">{track.title}</p>
                      <button
                        type="button"
                        className="scroll-card-sub artist-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTrackArtist(track);
                        }}
                      >
                        {track.artist}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {catalogPlaylists.length > 0 && (
              <div className="popular-block">
                <h4 className="popular-subtitle">{t('playlists')}</h4>
                <div className="horizontal-scroll hide-scrollbar">
                  {catalogPlaylists.slice(0, 8).map((playlist) => (
                    <div key={playlist.id} className="scroll-card playlist-scroll-card">
                      <div
                        className="scroll-card-cover playlist-cover media-cover-hover"
                        onClick={() => onOpenPlaylist(playlist)}
                      >
                        <img src={resolveCoverUrl(playlist.cover)} alt={playlist.name} />
                        <span className="playlist-badge">☰</span>
                        {(playlist.tracks?.length || 0) > 0 && (
                          <button
                            type="button"
                            className="scroll-card-play-btn"
                            data-ui-sound="none"
                            onClick={(e) => {
                              e.stopPropagation();
                              playPlaylist(playlist);
                            }}
                            aria-label={isPlaylistLive(playlist) ? t('wavePause') : t('playAll')}
                          >
                            {isPlaylistLive(playlist) ? <FaPause /> : <FaPlay />}
                          </button>
                        )}
                      </div>
                      <p className="scroll-card-title" onClick={() => onOpenPlaylist(playlist)}>
                        {playlist.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              )}

              <div className="popular-block">
                <h4 className="popular-subtitle">{t('artists')}</h4>
                <div className="horizontal-scroll hide-scrollbar artists-scroll">
                  {topArtists.map((track) => (
                    <button
                      key={track.artist}
                      type="button"
                      className="artist-card"
                      onClick={() => openTrackArtist(track)}
                    >
                      <div className="artist-avatar media-cover-hover">
                        <img src={resolveCoverUrl(track.cover)} alt={track.artist} />
                      </div>
                      <p className="artist-name">{track.artist}</p>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {currentView === 'search' && (
          <section className="search-results">
            <h3>{isSearchActive ? t('searchResults') : t('searchRecent')}</h3>

            {isSearchActive && (
              <div className="search-tabs">
                <button
                  type="button"
                  className={`search-tab${searchTab === 'tracks' ? ' active' : ''}`}
                  onClick={() => setSearchTab('tracks')}
                >
                  {t('searchTracks')}
                  {searchResults.length > 0 && (
                    <span className="search-tab-count"> {searchResults.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  className={`search-tab${searchTab === 'artists' ? ' active' : ''}`}
                  onClick={() => setSearchTab('artists')}
                >
                  {t('searchArtists')}
                  {searchArtistResults.length > 0 && (
                    <span className="search-tab-count"> {searchArtistResults.length}</span>
                  )}
                </button>
              </div>
            )}

            {(!isSearchActive || searchTab === 'tracks') && (
              searchDisplayTracks.length > 0 ? (
                <TrackList
                  tracks={searchDisplayTracks}
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  playTrack={playTrack}
                  toggleLike={toggleLike}
                  isTrackLiked={isTrackLiked}
                  userPlaylists={userPlaylists}
                  onAddToPlaylist={onAddTrackToPlaylist}
                  onCreatePlaylist={openCreateModal}
                  onOpenArtist={openTrackArtist}
                />
              ) : (
                !isSearching && (
                  <p className="no-results">
                    {isSearchActive ? t('noResults') : t('searchRecentEmpty')}
                  </p>
                )
              )
            )}

            {isSearchActive && searchTab === 'artists' && (
              searchArtistResults.length > 0 ? (
                <div className="artist-results-grid">
                  {searchArtistResults.map((artist) => (
                    <button
                      key={artist.id}
                      type="button"
                      className="artist-result-card"
                      onClick={() => onOpenArtist(artist)}
                    >
                      <div className="artist-result-avatar media-cover-hover">
                        <img src={artist.avatar} alt={artist.username} referrerPolicy="no-referrer" />
                      </div>
                      <p className="artist-result-name">{artist.fullName || artist.username}</p>
                    </button>
                  ))}
                </div>
              ) : (
                !isSearching && <p className="no-results">{t('noArtistResults')}</p>
              )
            )}
          </section>
        )}

        {currentView === 'history' && (
          history.length > 0 ? (
            <TrackList
              tracks={history}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              playTrack={playTrack}
              toggleLike={toggleLike}
              isTrackLiked={isTrackLiked}
              userPlaylists={userPlaylists}
              onAddToPlaylist={onAddTrackToPlaylist}
              onCreatePlaylist={openCreateModal}
              onOpenArtist={openTrackArtist}
            />
          ) : (
            <p className="no-results">{t('emptyHistory')}</p>
          )
        )}

        {currentView === 'liked' && (
          likedTracks.length > 0 ? (
            <TrackList
              tracks={likedTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              playTrack={playTrack}
              toggleLike={toggleLike}
              isTrackLiked={isTrackLiked}
              userPlaylists={userPlaylists}
              onAddToPlaylist={onAddTrackToPlaylist}
              onCreatePlaylist={openCreateModal}
              onOpenArtist={openTrackArtist}
            />
          ) : (
            <p className="no-results">{t('emptyLiked')}</p>
          )
        )}

        {currentView === 'library' && (
          <section className="library-section">
            <div className="library-actions">
              <button
                type="button"
                className="create-playlist-btn"
                onClick={() => setShowCreateModal(true)}
              >
                <FaPlus /> {t('createPlaylist')}
              </button>
              <button
                type="button"
                className="create-playlist-btn import-playlist-btn"
                onClick={() => {
                  setImportStatus('');
                  setShowImportModal(true);
                }}
              >
                <FaFileImport /> {t('importPlaylist')}
              </button>
            </div>

            {userPlaylists.length === 0 ? (
              <p className="no-results">{t('emptyLibrary')}</p>
            ) : (
              <div className="playlists-grid">
                {userPlaylists.map((playlist) => (
                  <div key={playlist.id} className="playlist-card glass-shine">
                    <div
                      className="playlist-card-cover"
                      onClick={() => onOpenPlaylist(playlist)}
                    >
                      <img src={resolveCoverUrl(playlist.cover)} alt={playlist.name} />
                      {playlist.tracks.length > 0 && (
                        <button
                          type="button"
                          className="playlist-card-play-btn"
                          data-ui-sound="none"
                          onClick={(e) => {
                            e.stopPropagation();
                            playPlaylist(playlist);
                          }}
                          aria-label={isPlaylistLive(playlist) ? t('wavePause') : t('playAll')}
                        >
                          {isPlaylistLive(playlist) ? <FaPause /> : <FaPlay />}
                        </button>
                      )}
                    </div>
                    <div className="playlist-card-body">
                      <div className="playlist-card-info">
                        <h4 onClick={() => onOpenPlaylist(playlist)}>{playlist.name}</h4>
                        <span>{playlist.tracks.length} {t('playlistTracks')}</span>
                      </div>
                      <button
                        type="button"
                        className="delete-playlist-btn"
                        onClick={() => onDeletePlaylist(playlist.id)}
                        title={t('deletePlaylist')}
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentView === 'playlist' && activePlaylist && (
          <PlaylistView
            playlist={activePlaylist}
            isEditable={userPlaylists.some((p) => p.id === activePlaylist.id)}
            onUpdate={onUpdatePlaylist}
            onDelete={onDeletePlaylist}
            onRemoveTrack={onRemoveTrackFromPlaylist}
            onReorderTracks={onReorderPlaylistTracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={(track, queue) =>
              playTrack(track, queue || activePlaylist.tracks, activePlaylist.id)
            }
            playbackPlaylistId={playbackPlaylistId}
            toggleLike={toggleLike}
            isTrackLiked={isTrackLiked}
            userPlaylists={userPlaylists}
            onAddToPlaylist={onAddTrackToPlaylist}
            onCreatePlaylist={openCreateModal}
            ownerName={profileDisplayName}
            onOpenArtist={openTrackArtist}
          />
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <form className="modal-card glass-search" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
            <h3>{t('createPlaylist')}</h3>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder={t('playlistName')}
              autoFocus
            />
            <input
              type="text"
              value={newPlaylistDescription}
              onChange={(e) => setNewPlaylistDescription(e.target.value)}
              placeholder={t('playlistDescriptionPlaceholder')}
            />
            <input
              type="url"
              value={newPlaylistCover}
              onChange={(e) => setNewPlaylistCover(e.target.value)}
              placeholder={t('playlistCoverPlaceholder')}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setShowCreateModal(false)}>
                {t('cancel')}
              </button>
              <button type="submit" className="primary">
                {t('create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => !isImporting && setShowImportModal(false)}>
          <form className="modal-card import-modal-card glass-search" onClick={(e) => e.stopPropagation()} onSubmit={handleImport}>
            <h3>{t('importPlaylist')}</h3>
            <p className="import-help">{t('importPlaylistHelp')}</p>
            <input
              type="text"
              value={importPlaylistName}
              onChange={(e) => setImportPlaylistName(e.target.value)}
              placeholder={t('importPlaylistNamePlaceholder')}
              disabled={isImporting}
              autoFocus
            />
            <textarea
              value={importPlaylistInput}
              onChange={(e) => setImportPlaylistInput(e.target.value)}
              placeholder={t('importPlaylistPlaceholder')}
              disabled={isImporting}
              rows={8}
            />
            {importStatus && <p className="import-status">{importStatus}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setShowImportModal(false)} disabled={isImporting}>
                {t('cancel')}
              </button>
              <button type="submit" className="primary" disabled={isImporting || !importPlaylistInput.trim()}>
                {isImporting ? t('importPlaylistLoading') : t('importPlaylistAction')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default MainContent;
