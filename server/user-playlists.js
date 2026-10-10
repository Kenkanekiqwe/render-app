const db = require('./db');

function serializePlaylist(row, { includeTracks = true } = {}) {
  let tracks = [];
  let trackCount = 0;
  try {
    tracks = JSON.parse(row.tracks_json || '[]');
    trackCount = Array.isArray(tracks) ? tracks.length : 0;
  } catch {
    tracks = [];
  }

  const base = {
    id: row.local_id,
    name: row.name,
    description: row.description || '',
    cover: row.cover_url || '',
    isUser: true,
    source: row.source || 'user',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    trackCount,
  };

  if (includeTracks) {
    base.tracks = Array.isArray(tracks) ? tracks : [];
  } else {
    base.tracks = [];
  }

  return base;
}

async function getUserPlaylists(userId, options) {
  const rows = await db.query(
    `SELECT local_id, name, description, cover_url, tracks_json, source, created_at
     FROM user_playlists
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map((row) => serializePlaylist(row, options));
}

async function getUserPlaylistById(userId, localId) {
  const rows = await db.query(
    `SELECT local_id, name, description, cover_url, tracks_json, source, created_at
     FROM user_playlists
     WHERE user_id = ? AND local_id = ?
     LIMIT 1`,
    [userId, String(localId)]
  );
  if (!rows.length) return null;
  return serializePlaylist(rows[0], { includeTracks: true });
}

async function getUserPlaylistsSummary(userId) {
  return getUserPlaylists(userId, { includeTracks: false });
}

async function syncUserPlaylists(userId, playlists) {
  const valid = (Array.isArray(playlists) ? playlists : []).filter((p) => p?.id && p?.name);
  const ids = valid.map((p) => String(p.id));

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    await db.query(
      `DELETE FROM user_playlists WHERE user_id = ? AND local_id NOT IN (${placeholders})`,
      [userId, ...ids]
    );
  } else {
    await db.query('DELETE FROM user_playlists WHERE user_id = ?', [userId]);
  }

  for (const playlist of valid) {
    await db.query(
      `INSERT INTO user_playlists (user_id, local_id, name, description, cover_url, tracks_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         cover_url = VALUES(cover_url),
         tracks_json = VALUES(tracks_json),
         source = VALUES(source),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        String(playlist.id),
        String(playlist.name).slice(0, 120),
        String(playlist.description || '').slice(0, 500),
        String(playlist.cover || ''),
        JSON.stringify(Array.isArray(playlist.tracks) ? playlist.tracks : []),
        String(playlist.source || 'user').slice(0, 32),
      ]
    );
  }

  return getUserPlaylists(userId, { includeTracks: true });
}

module.exports = {
  getUserPlaylists,
  getUserPlaylistsSummary,
  getUserPlaylistById,
  syncUserPlaylists,
  serializePlaylist,
};
