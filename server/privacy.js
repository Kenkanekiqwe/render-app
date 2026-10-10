const db = require('./db');

function privacyFromRow(row) {
  return {
    hiddenAccount: Boolean(row.privacy_hidden_account),
    hideCreatedAt: Boolean(row.privacy_hide_created_at),
    hidePlaylists: Boolean(row.privacy_hide_playlists),
    hideAvatar: Boolean(row.privacy_hide_avatar),
    hideBanner: Boolean(row.privacy_hide_banner),
    hideNowPlaying: Boolean(row.privacy_hide_now_playing),
  };
}

function applyPrivacyToProfile(profile, row, { isOwner }) {
  if (isOwner) {
    return { ...profile, privacy: privacyFromRow(row) };
  }

  if (row.privacy_hidden_account) {
    return null;
  }

  const result = { ...profile };
  if (row.privacy_hide_avatar) result.avatarUrl = '';
  if (row.privacy_hide_banner) result.bannerUrl = '';
  if (row.privacy_hide_created_at) result.createdAt = null;
  return result;
}

async function areFriends(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const rows = await db.query(
    `SELECT id FROM friendships
     WHERE status = 'accepted'
       AND (
         (requester_id = ? AND addressee_id = ?)
         OR (requester_id = ? AND addressee_id = ?)
       )
     LIMIT 1`,
    [userIdA, userIdB, userIdB, userIdA]
  );
  return rows.length > 0;
}

function parsePrivacyBody(body) {
  const keys = [
    'hiddenAccount',
    'hideCreatedAt',
    'hidePlaylists',
    'hideAvatar',
    'hideBanner',
    'hideNowPlaying',
  ];
  const result = {};
  for (const key of keys) {
    if (body?.[key] != null) {
      result[key] = Boolean(body[key]);
    }
  }
  return result;
}

module.exports = {
  privacyFromRow,
  applyPrivacyToProfile,
  areFriends,
  parsePrivacyBody,
};
