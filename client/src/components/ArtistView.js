import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './ArtistView.css';
import TrackList from './TrackList';
import ScPlaylistView from './ScPlaylistView';
import {
  FaCheckCircle,
  FaPlay,
  FaPause,
  FaMusic,
  FaHeadphones,
  FaGlobeAmericas,
} from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { cachedRequest } from '../utils/apiCache';
import { resolveCoverUrl } from '../utils/tracks';

function formatCount(value) {
  const num = Number(value) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function ArtistView({
  artistId,
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
  onOpenArtistFromTrack,
}) {
  const { t } = useLanguage();
  const [artist, setArtist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      setActivePlaylist(null);
      setPlaylistTracks([]);

      try {
        const data = await cachedRequest(
          () => axios.get(`/api/artists/${artistId}/profile`).then((res) => res.data),
          `artist-profile:${artistId}`,
          3 * 60 * 1000
        );

        if (cancelled) return;

        setArtist(data.artist);
        setTracks(data.tracks || []);
        setPlaylists(data.playlists || []);
        setSimilarArtists(data.similar || []);
      } catch {
        if (!cancelled) {
          setArtist(null);
          setError(t('artistNotFound'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [artistId, t]);

  const popularTracks = useMemo(() => tracks.slice(0, 12), [tracks]);
  const totalPlays = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.plays || 0), 0),
    [tracks]
  );

  const playbackId = `artist-${artistId}`;
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

  const openArtistPlaylist = async (playlist) => {
    setPlaylistLoading(true);
    try {
      const data = await cachedRequest(
        () => axios.get(`/api/sc-playlists/${playlist.id}`).then((res) => res.data),
        `sc-playlist:${playlist.id}`,
        5 * 60 * 1000
      );
      setActivePlaylist(data);
      setPlaylistTracks(data.tracks || []);
    } catch {
      setActivePlaylist(null);
      setPlaylistTracks([]);
    } finally {
      setPlaylistLoading(false);
    }
  };

  if (loading) {
    return <p className="loading-message subtle">{t('loadingArtist')}</p>;
  }

  if (error || !artist) {
    return <p className="no-results">{error || t('artistNotFound')}</p>;
  }

  if (activePlaylist) {
    return (
      <ScPlaylistView
        playlist={activePlaylist}
        tracks={playlistTracks}
        subtitle={artist.fullName || artist.username}
        onBack={() => {
          setActivePlaylist(null);
          setPlaylistTracks([]);
        }}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        playTrack={playTrack}
        playbackId={`artist-pl-${activePlaylist.id}`}
        playbackPlaylistId={playbackPlaylistId}
        toggleLike={toggleLike}
        isTrackLiked={isTrackLiked}
        userPlaylists={userPlaylists}
        onAddToPlaylist={onAddToPlaylist}
        onCreatePlaylist={onCreatePlaylist}
        onOpenArtist={onOpenArtistFromTrack || onOpenArtist}
        t={t}
      />
    );
  }

  if (playlistLoading) {
    return <p className="loading-message subtle">{t('loadingTracks')}</p>;
  }

  return (
    <section className="artist-view">
      <div className="artist-profile-hero">
        <div
          className="artist-profile-bg"
          style={{ backgroundImage: `url(${artist.banner})` }}
          aria-hidden="true"
        />

        <div className="artist-profile-header">
          <div className="artist-profile-avatar">
            <img src={artist.avatar} alt={artist.username} referrerPolicy="no-referrer" />
          </div>

          <div className="artist-profile-info">
            <div className="artist-profile-name">
              <h1>{artist.fullName || artist.username}</h1>
              {artist.verified && (
                <FaCheckCircle className="artist-verified" aria-label={t('verified')} />
              )}
            </div>

            <div className="artist-profile-stats">
              {artist.trackCount > 0 && (
                <span>
                  <FaMusic /> {formatCount(artist.trackCount)} {t('artistTracksCount')}
                </span>
              )}
              {totalPlays > 0 && (
                <span>
                  <FaHeadphones /> {formatCount(totalPlays)}
                </span>
              )}
              {(artist.location || artist.countryCode) && (
                <span>
                  <FaGlobeAmericas /> {artist.countryCode || artist.location}
                </span>
              )}
            </div>
          </div>
        </div>

        {artist.description && (
          <p className="artist-profile-bio">{artist.description}</p>
        )}

        {tracks.length > 0 && (
          <button
            type="button"
            className="artist-profile-play"
            data-ui-sound="none"
            onClick={handlePlayAll}
          >
            {playlistIsLive ? <FaPause /> : <FaPlay />}
            {playlistIsLive ? t('wavePause') : t('playAll')}
          </button>
        )}
      </div>

      {popularTracks.length > 0 && (
        <section className="artist-section">
          <h3 className="artist-section-title">{t('artistPopular')}</h3>
          <div className="artist-media-scroll hide-scrollbar">
            {popularTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="artist-media-card glass-shine"
                onClick={() => playTrack(track, tracks, playbackId)}
              >
                <div className="artist-media-cover media-cover-hover">
                  <img src={resolveCoverUrl(track.cover)} alt={track.title} referrerPolicy="no-referrer" />
                  <span className="artist-media-badge">☁</span>
                </div>
                <p className="artist-media-title">{track.title}</p>
                <p className="artist-media-sub">{track.artist}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {playlists.length > 0 && (
        <section className="artist-section">
          <h3 className="artist-section-title">{t('albums')}</h3>
          <div className="artist-media-scroll hide-scrollbar">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="artist-media-card glass-shine"
                onClick={() => openArtistPlaylist(playlist)}
              >
                <div className="artist-media-cover album media-cover-hover">
                  <img src={resolveCoverUrl(playlist.cover)} alt={playlist.name} referrerPolicy="no-referrer" />
                </div>
                <p className="artist-media-title">{playlist.name}</p>
                <p className="artist-media-sub">
                  {formatCount(playlist.trackCount)} {t('playlistTracks')}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {similarArtists.length > 0 && (
        <section className="artist-section">
          <h3 className="artist-section-title">{t('similarArtists')}</h3>
          <div className="artist-similar-scroll hide-scrollbar">
            {similarArtists.map((item) => (
              <button
                key={item.id}
                type="button"
                className="artist-similar-card"
                onClick={() => onOpenArtist?.(item)}
              >
                <div className="artist-similar-avatar media-cover-hover">
                  <img src={resolveCoverUrl(item.avatar)} alt={item.username} referrerPolicy="no-referrer" />
                </div>
                <p className="artist-similar-name">{item.fullName || item.username}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {tracks.length > 0 && (
        <section className="artist-section artist-tracks-section">
          <h3 className="artist-section-title">{t('tracks')}</h3>
          <TrackList
            variant="artist"
            tracks={tracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={(track) => playTrack(track, tracks, playbackId)}
            toggleLike={toggleLike}
            isTrackLiked={isTrackLiked}
            userPlaylists={userPlaylists}
            onAddToPlaylist={onAddToPlaylist}
            onCreatePlaylist={onCreatePlaylist}
            onOpenArtist={onOpenArtistFromTrack || onOpenArtist}
          />
        </section>
      )}

      {tracks.length === 0 && playlists.length === 0 && (
        <p className="no-results">{t('emptyArtistTracks')}</p>
      )}
    </section>
  );
}

export default ArtistView;
