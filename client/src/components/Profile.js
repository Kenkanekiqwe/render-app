import React, { useState, useEffect } from 'react';
import './Profile.css';
import { CosmeticAvatar, CosmeticName, CosmeticBadges, AdminPlaque } from './ProfileCosmetics';
import TrackList from './TrackList';
import { FaEdit, FaSave, FaTimes, FaMusic, FaHeart, FaPlay, FaPause, FaSignOutAlt } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import StaticIdBadge from './StaticIdBadge';
import BannerImage from './BannerImage';
import ProfileTrackCard from './ProfileTrackCard';
import { ProfileLinks, ProfileLinksEditor } from './ProfileLinks';
import { slimTrackForProfile, hydrateProfileTrack } from '../utils/profile';
import { normalizeProfileLinks } from '../utils/profileLinks';

function formatMemberDate(timestamp, locale) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function Profile({
  profile,
  onUpdateProfile,
  onSyncProfile,
  userPlaylists,
  likedTracks,
  currentTrack,
  isPlaying,
  playTrack,
  playPlaylist,
  playbackPlaylistId,
  toggleLike,
  isTrackLiked,
  onOpenPlaylist,
  onOpenArtist,
  pinnedTrack,
  onPinTrack,
  onUnpinTrack,
  startEditing = false,
  onEditingChange,
  onLogout,
  equippedCosmetics,
  isAdmin,
}) {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState('playlists');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    displayName: profile.displayName || '',
    username: profile.username || '',
    bio: profile.bio || '',
    avatarUrl: profile.avatarUrl || '',
    bannerUrl: profile.bannerUrl || '',
    links: normalizeProfileLinks(profile.links),
  });

  const setEditingState = (value) => {
    setEditing(value);
    onEditingChange?.(value);
  };

  useEffect(() => {
    if (editing) return;
    setForm({
      displayName: profile.displayName || '',
      username: profile.username || '',
      bio: profile.bio || '',
      avatarUrl: profile.avatarUrl || '',
      bannerUrl: profile.bannerUrl || '',
      links: normalizeProfileLinks(profile.links),
    });
  }, [
    editing,
    profile.displayName,
    profile.username,
    profile.bio,
    profile.avatarUrl,
    profile.bannerUrl,
    profile.links,
  ]);

  useEffect(() => {
    if (startEditing) setEditingState(true);
  }, [startEditing]);

  const localeMap = {
    russian: 'ru-RU',
    english: 'en-US',
    ukrainian: 'uk-UA',
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const rawLinks = Array.isArray(form.links) ? form.links : [];
    const hasAnyUrl = rawLinks.some((item) => String(item?.url || '').trim());
    const links = normalizeProfileLinks(rawLinks);
    if (rawLinks.length && !hasAnyUrl) {
      setSaveError(t('profileLinkNeedUrl'));
      return;
    }
    if (hasAnyUrl && links.length === 0) {
      setSaveError(t('profileLinkInvalid'));
      return;
    }

    setSaving(true);
    setSaveError('');
    const displayName = form.displayName.trim() || profile.displayName;
    const username = form.username.trim().replace(/^@/, '') || profile.username;
    const updates = {
      displayName,
      username,
      bio: form.bio.trim(),
      avatarUrl: form.avatarUrl.trim(),
      bannerUrl: form.bannerUrl.trim(),
      links,
    };

    try {
      if (onSyncProfile) {
        const synced = await onSyncProfile(updates);
        if (synced) {
          setEditingState(false);
          return;
        }
        setSaveError(t('profileSaveError'));
        return;
      }
      onUpdateProfile(updates);
      setEditingState(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSaveError('');
    setForm({
      displayName: profile.displayName || '',
      username: profile.username || '',
      bio: profile.bio || '',
      avatarUrl: profile.avatarUrl || '',
      bannerUrl: profile.bannerUrl || '',
      links: normalizeProfileLinks(profile.links),
    });
    setEditingState(false);
  };

  const previewAvatar = editing ? form.avatarUrl : profile.avatarUrl;
  const previewBanner = editing ? form.bannerUrl : profile.bannerUrl;
  const previewName = editing ? form.displayName || profile.displayName : profile.displayName;
  const usernameRaw = (editing ? form.username : profile.username || 'renderuser').replace(/^@/, '');
  const pinnedIsLive = pinnedTrack && currentTrack?.id === pinnedTrack.id;

  return (
    <div className="profile-page">
      <div className="profile-body">
        <header className={`profile-hero${editing ? ' is-editing' : ''}`}>
          <div className="profile-hero-banner">
            {previewBanner ? <BannerImage url={previewBanner} /> : <div className="profile-banner-fallback" />}
          </div>

          <div className="profile-hero-bar">
            <div className="profile-avatar-wrap">
              <CosmeticAvatar
                url={previewAvatar}
                fallback={(previewName || usernameRaw || 'R').slice(0, 1).toUpperCase()}
                alt={previewName}
                equipped={equippedCosmetics}
              />
            </div>

            <div className="profile-hero-meta">
              <div className="profile-handle-row">
                <CosmeticName equipped={equippedCosmetics} className="profile-handle" as="h1">
                  {previewName || usernameRaw}
                </CosmeticName>
                <CosmeticBadges equipped={equippedCosmetics} />
                <AdminPlaque isAdmin={isAdmin} />
                {!editing && <StaticIdBadge staticId={profile.staticId} />}
              </div>
              <div className="profile-display-row">
                <p className="profile-username-sub">@{usernameRaw}</p>
                {!editing && profile.createdAt && (
                  <span className="profile-member-badge">
                    {formatMemberDate(profile.createdAt, localeMap[language] || 'en-US')}
                  </span>
                )}
              </div>
              {!editing && profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
              {!editing && (
                <div className="profile-stats">
                  <span><strong>{userPlaylists.length}</strong> {t('profilePlaylistsTab')}</span>
                  <span><strong>{likedTracks.length}</strong> {t('profileLikedTab')}</span>
                </div>
              )}
            </div>

            {!editing && (
              <div className="profile-hero-actions">
                <button
                  type="button"
                  className="profile-action-btn"
                  onClick={() => {
                    setSaveError('');
                    setEditingState(true);
                  }}
                >
                  <FaEdit /> {t('editProfile')}
                </button>
                {onLogout && (
                  <button type="button" className="profile-action-btn profile-action-btn--danger" onClick={onLogout}>
                    <FaSignOutAlt /> {t('logout')}
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {!editing && <ProfileLinks links={profile.links} t={t} />}

        {!editing && (pinnedTrack || currentTrack) && (
          <div className="profile-pin-rail">
            {pinnedTrack ? (
              <ProfileTrackCard
                variant="inline"
                track={pinnedTrack}
                label={t('profilePinnedTrack')}
                isPlaying={isPlaying}
                isLive={pinnedIsLive}
                onPlay={(track) => {
                  const playable = hydrateProfileTrack(track);
                  if (playable) playTrack?.(playable, [playable]);
                }}
                showPinActions
                onPin={
                  currentTrack && currentTrack.id !== pinnedTrack.id
                    ? () => onPinTrack?.(slimTrackForProfile(currentTrack))
                    : null
                }
                onUnpin={onUnpinTrack}
                t={t}
              />
            ) : (
              <ProfileTrackCard
                variant="inline"
                track={currentTrack}
                label={t('profileCurrentTrack')}
                isPlaying={isPlaying}
                isLive={Boolean(isPlaying)}
                onPlay={(track) => {
                  const playable = hydrateProfileTrack(track);
                  if (playable) playTrack?.(playable, [playable]);
                }}
                showPinActions
                onPin={() => onPinTrack?.(slimTrackForProfile(currentTrack))}
                t={t}
              />
            )}
          </div>
        )}

        {editing ? (
          <form className="profile-editor" onSubmit={handleSave} noValidate>
            <div className="profile-editor-copy">
              <h2>{t('profileEditTitle')}</h2>
              <p>{t('profileEditHint')}</p>
            </div>

            <section className="profile-editor-section">
              <h3>{t('profileEditIdentity')}</h3>
              <div className="profile-editor-grid">
                <label className="profile-field" htmlFor="profile-name">
                  <span>{t('profileDisplayName')}</span>
                  <input
                    id="profile-name"
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                  />
                </label>
                <label className="profile-field" htmlFor="profile-username">
                  <span>{t('profileUsername')}</span>
                  <input
                    id="profile-username"
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                  />
                </label>
                <label className="profile-field profile-field-wide" htmlFor="profile-bio">
                  <span>{t('profileBio')}</span>
                  <textarea
                    id="profile-bio"
                    value={form.bio}
                    rows={3}
                    onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))}
                    placeholder={t('profileBioPlaceholder')}
                  />
                </label>
              </div>
            </section>

            <section className="profile-editor-section">
              <h3>{t('profileEditLooks')}</h3>
              <div className="profile-editor-media">
                <label className="profile-media-field" htmlFor="profile-avatar">
                  <span>{t('avatarSection')}</span>
                  <div className="profile-media-field__row">
                    <div className="profile-media-avatar">
                      <CosmeticAvatar
                        url={form.avatarUrl}
                        fallback={(form.displayName || usernameRaw || 'R').slice(0, 1).toUpperCase()}
                        alt={form.displayName}
                        equipped={equippedCosmetics}
                      />
                    </div>
                    <input
                      id="profile-avatar"
                      type="url"
                      value={form.avatarUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, avatarUrl: e.target.value }))}
                      placeholder="https://"
                    />
                  </div>
                </label>
                <label className="profile-media-field profile-media-field--banner" htmlFor="profile-banner">
                  <span>{t('profileBanner')}</span>
                  <div className="profile-media-banner">
                    {form.bannerUrl ? (
                      <BannerImage url={form.bannerUrl} />
                    ) : (
                      <div className="profile-banner-fallback" />
                    )}
                  </div>
                  <input
                    id="profile-banner"
                    type="url"
                    value={form.bannerUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, bannerUrl: e.target.value }))}
                    placeholder={t('profileBannerPlaceholder')}
                  />
                  <em className="profile-field-hint">{t('profileBannerHint')}</em>
                </label>
              </div>
            </section>

            <ProfileLinksEditor
              links={form.links}
              onChange={(links) => setForm((prev) => ({ ...prev, links }))}
              t={t}
            />

            <div className="profile-editor-actions">
              {saveError ? <p className="profile-save-error">{saveError}</p> : null}
              <button type="button" className="profile-btn profile-btn-ghost" onClick={handleCancel} disabled={saving}>
                <FaTimes /> {t('cancel')}
              </button>
              <button type="submit" className="profile-btn profile-btn-primary" disabled={saving}>
                <FaSave /> {saving ? t('loadingTracks') : t('saveProfile')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="profile-tabs" role="tablist">
              <button
                type="button"
                className={`profile-tab${activeTab === 'playlists' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('playlists')}
              >
                <FaMusic /> {t('profilePlaylistsTab')}
                <em>{userPlaylists.length}</em>
              </button>
              <button
                type="button"
                className={`profile-tab${activeTab === 'liked' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('liked')}
              >
                <FaHeart /> {t('profileLikedTab')}
                <em>{likedTracks.length}</em>
              </button>
            </div>

            <div className="profile-content">
              {activeTab === 'playlists' && (
                userPlaylists.length > 0 ? (
                  <div className="profile-playlists-grid hide-scrollbar">
                    {userPlaylists.map((playlist) => {
                      const live =
                        playbackPlaylistId === playlist.id &&
                        isPlaying &&
                        currentTrack &&
                        playlist.tracks?.some((track) => track.id === currentTrack.id);
                      return (
                        <div key={playlist.id} className="profile-playlist-card">
                          <button
                            type="button"
                            className="profile-playlist-open"
                            onClick={() => onOpenPlaylist(playlist)}
                          >
                            <div className="profile-playlist-cover">
                              <img src={playlist.cover} alt="" referrerPolicy="no-referrer" />
                            </div>
                            <h3>{playlist.name}</h3>
                            <p>{playlist.tracks?.length || 0} {t('playlistTracks')}</p>
                          </button>
                          {(playlist.tracks?.length || 0) > 0 && (
                            <button
                              type="button"
                              className="profile-playlist-play"
                              data-ui-sound="none"
                              onClick={() => playPlaylist?.(playlist)}
                              aria-label={live ? t('wavePause') : t('playAll')}
                            >
                              {live ? <FaPause /> : <FaPlay />}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="profile-empty">{t('emptyLibrary')}</p>
                )
              )}

              {activeTab === 'liked' && (
                likedTracks.length > 0 ? (
                  <TrackList
                    tracks={likedTracks}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    playTrack={playTrack}
                    toggleLike={toggleLike}
                    isTrackLiked={isTrackLiked}
                    onOpenArtist={onOpenArtist}
                  />
                ) : (
                  <p className="profile-empty">{t('emptyLiked')}</p>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Profile;
