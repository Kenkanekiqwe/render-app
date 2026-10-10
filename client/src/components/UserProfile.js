import React, { useEffect, useState } from 'react';
import './UserProfile.css';
import './Profile.css';
import { FaArrowLeft, FaMusic } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { fetchUserProfile } from '../utils/auth';
import { CosmeticAvatar, CosmeticName, CosmeticBadges, AdminPlaque } from './ProfileCosmetics';
import StaticIdBadge from './StaticIdBadge';
import BannerImage from './BannerImage';
import ProfileTrackCard from './ProfileTrackCard';
import { ProfileLinks } from './ProfileLinks';

function formatMemberDate(timestamp, locale) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function UserProfile({
  userId,
  onBack,
  onOpenPlaylist,
  playTrack,
  currentTrack,
  isPlaying,
}) {
  const { t, language } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [isFriend, setIsFriend] = useState(false);
  const [playlistsHidden, setPlaylistsHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const localeMap = {
    russian: 'ru-RU',
    english: 'en-US',
    ukrainian: 'uk-UA',
  };

  useEffect(() => {
    let cancelled = false;
    let pollId = 0;

    const loadProfile = (initial = false) => {
      if (initial) {
        setLoading(true);
        setError('');
      }

      fetchUserProfile(userId)
        .then((data) => {
          if (cancelled) return;
          setProfile(data.profile);
          setPlaylists(data.playlists || []);
          setNowPlaying(data.nowPlaying || null);
          setIsFriend(Boolean(data.isFriend));
          setPlaylistsHidden(Boolean(data.playlistsHidden));
        })
        .catch((err) => {
          if (cancelled) return;
          if (err?.response?.status === 404) {
            setError(t('userProfileHidden'));
          } else {
            setError(t('userProfileLoadError'));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    loadProfile(true);
    pollId = window.setInterval(() => loadProfile(false), 15000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [userId, t]);

  if (loading && !profile) {
    return <div className="user-profile-page"><p className="user-profile-empty">{t('loadingTracks')}</p></div>;
  }

  if (error || !profile) {
    return (
      <div className="user-profile-page">
        <button type="button" className="user-profile-back" onClick={onBack}>
          <FaArrowLeft /> {t('back')}
        </button>
        <p className="user-profile-empty">{error || t('userProfileNotFound')}</p>
      </div>
    );
  }

  const usernameRaw = (profile.username || 'user').replace(/^@/, '');
  const showBanner = Boolean(profile.bannerUrl);
  const showAvatar = Boolean(profile.avatarUrl);
  const pinnedTrack = profile.pinnedTrack || null;
  const equippedCosmetics = profile.equippedCosmetics || null;
  const liveTrack = nowPlaying?.track || null;
  const liveIsCurrent = liveTrack && currentTrack?.id === liveTrack.id;

  return (
    <div className="user-profile-page">
      <div className="profile-body">
        <button type="button" className="user-profile-back" onClick={onBack}>
          <FaArrowLeft /> {t('back')}
        </button>

        <div className="profile-card">
          <div className="profile-banner-wrap">
            {showBanner ? (
              <BannerImage url={profile.bannerUrl} />
            ) : (
              <div className="profile-banner-fallback" />
            )}
          </div>

          <div className="profile-identity">
            <div className="profile-avatar-wrap">
              <CosmeticAvatar
                url={showAvatar ? profile.avatarUrl : ''}
                fallback={usernameRaw[0] || 'R'}
                alt={profile.displayName}
                equipped={equippedCosmetics}
              />
            </div>

            <div className="profile-identity-content">
              <div className="profile-handle-row">
                <CosmeticName equipped={equippedCosmetics} className="profile-handle" as="h1">
                  {profile.displayName || usernameRaw}
                </CosmeticName>
                <CosmeticBadges equipped={equippedCosmetics} />
                <AdminPlaque isAdmin={profile.isAdmin} />
                <StaticIdBadge staticId={profile.staticId} />
              </div>
              <div className="profile-display-row">
                <p className="profile-username-sub">@{usernameRaw}</p>
                {profile.createdAt && (
                  <span className="profile-member-badge">
                    {formatMemberDate(profile.createdAt, localeMap[language] || 'en-US')}
                  </span>
                )}
              </div>
              {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            </div>
          </div>
        </div>

        <ProfileLinks links={profile.links} t={t} />

        {pinnedTrack && (
          <div className="profile-pin-rail">
            <ProfileTrackCard
              variant="inline"
              track={pinnedTrack}
              label={t('profilePinnedTrack')}
              isPlaying={isPlaying}
              isLive={currentTrack?.id === pinnedTrack.id}
              onPlay={(track) => playTrack?.(track, [track])}
              t={t}
            />
          </div>
        )}

        {isFriend && liveTrack && (
          <div className="profile-card-now-playing">
            <ProfileTrackCard
              variant="inline"
              track={liveTrack}
              label={nowPlaying?.isPlaying ? t('profileNowPlaying') : t('profileLastPlayed')}
              isPlaying={Boolean(nowPlaying?.isPlaying && liveIsCurrent && isPlaying)}
              isLive={nowPlaying?.isPlaying}
              onPlay={(track) => playTrack?.(track, [track])}
              t={t}
            />
          </div>
        )}

        <div className="user-profile-playlists">
          <h2>
            <FaMusic /> {t('profilePlaylistsTab')}
          </h2>
          {playlists.length > 0 ? (
            <div className="profile-playlists-grid hide-scrollbar">
              {playlists.map((playlist) => {
                const trackCount = playlist.trackCount ?? playlist.tracks?.length ?? 0;

                return (
                  <div key={playlist.id} className="profile-playlist-card">
                    <button
                      type="button"
                      className="profile-playlist-open"
                      onClick={() => onOpenPlaylist?.(playlist)}
                    >
                      <div className="profile-playlist-cover media-cover-hover">
                        <img
                          src={playlist.cover || 'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg'}
                          alt={playlist.name}
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="profile-playlist-info">
                        <h3>{playlist.name}</h3>
                        <p className="user-profile-playlist-meta">
                          {trackCount} {t('playlistTracks')}
                        </p>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="user-profile-empty">
              {playlistsHidden
                ? t('userProfilePlaylistsHidden')
                : !isFriend
                  ? t('userProfileNotFriend')
                  : t('emptyLibrary')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default UserProfile;
