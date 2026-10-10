import { getDefaultProfile } from './storage';
import { normalizeProfileLinks } from './profileLinks';

export const DEFAULT_PRIVACY = {
  hiddenAccount: false,
  hideCreatedAt: false,
  hidePlaylists: false,
  hideAvatar: false,
  hideBanner: false,
  hideNowPlaying: false,
};

export function privacyFromUser(user) {
  return { ...DEFAULT_PRIVACY, ...(user?.privacy || {}) };
}

export function profileFromUser(user) {
  if (!user) return getDefaultProfile();
  return {
    displayName: user.displayName || 'Render User',
    username: user.username || 'renderuser',
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    staticId: user.staticId || '',
    bannerUrl: user.bannerUrl || '',
    createdAt: user.createdAt || Date.now(),
    pinnedTrack: user.pinnedTrack || null,
    links: normalizeProfileLinks(user.links),
  };
}

export function slimTrackForProfile(track) {
  if (!track?.id) return null;
  const soundcloudUrl = track.soundcloudUrl || track.url || '';
  return {
    id: track.id,
    title: track.title || '',
    artist: track.artist || '',
    cover: track.cover || '',
    soundcloudUrl,
    url: soundcloudUrl,
    duration: track.duration || 0,
  };
}

/** Restore fields needed for SoundCloud playback after loading from profile JSON. */
export function hydrateProfileTrack(track) {
  const slim = slimTrackForProfile(track);
  if (!slim) return null;
  return { ...track, ...slim };
}

export function buildProfilePayload(profile, backgroundUrl = '') {
  const payload = {
    displayName: profile.displayName,
    username: profile.username ? String(profile.username).replace(/^@/, '').trim() : undefined,
    avatarUrl: profile.avatarUrl || '',
    bio: profile.bio || '',
    bannerUrl: profile.bannerUrl || '',
    backgroundUrl: backgroundUrl || '',
  };
  if (Array.isArray(profile.links)) {
    payload.links = normalizeProfileLinks(profile.links);
  }
  return payload;
}

export function profileNeedsServerSync(user, payload) {
  if (!user) return true;
  const linksChanged = Object.prototype.hasOwnProperty.call(payload, 'links')
    ? JSON.stringify(payload.links || []) !== JSON.stringify(user.links || [])
    : false;
  return (
    payload.bannerUrl !== (user.bannerUrl || '') ||
    payload.avatarUrl !== (user.avatarUrl || '') ||
    payload.bio !== (user.bio || '') ||
    payload.displayName !== (user.displayName || '') ||
    payload.backgroundUrl !== (user.backgroundUrl || '') ||
    linksChanged
  );
}

/** One-time merge: push legacy localStorage profile fields into the server. */
export function buildMigrationPayload(user, localProfile, localBackgroundUrl = '') {
  const serverLinks = Array.isArray(user?.links) ? user.links : [];
  const localLinks = Array.isArray(localProfile?.links) ? localProfile.links : [];
  const merged = {
    ...profileFromUser(user),
    avatarUrl: user.avatarUrl || localProfile.avatarUrl || '',
    bio: user.bio || localProfile.bio || '',
    bannerUrl: user.bannerUrl || localProfile.bannerUrl || '',
    links: serverLinks.length ? serverLinks : localLinks,
  };

  const backgroundUrl = user.backgroundUrl || localBackgroundUrl || '';
  return buildProfilePayload(merged, backgroundUrl);
}

export function privacyNeedsServerSync(user, privacy) {
  const current = privacyFromUser(user);
  return Object.keys(DEFAULT_PRIVACY).some((key) => Boolean(privacy[key]) !== Boolean(current[key]));
}
