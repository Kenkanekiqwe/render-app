const express = require('express');
const db = require('./db');
const { authMiddleware, publicUser } = require('./auth');
const { parseNowPlayingJson } = require('./profile-extras');

const router = express.Router();

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function formatFriendRow(row, currentUserId) {
  const isIncoming = row.addressee_id === currentUserId;
  const user = publicUser({
    id: row.friend_id,
    username: row.friend_username,
    display_name: row.friend_display_name,
    avatar_url: row.friend_avatar_url,
    bio: row.friend_bio,
    static_id: row.friend_static_id,
    created_at: row.friend_created_at,
    is_admin: row.friend_is_admin,
  });

  const hideNowPlaying = Boolean(row.friend_privacy_hide_now_playing);
  const nowPlaying = hideNowPlaying || row.status !== 'accepted'
    ? null
    : parseNowPlayingJson(row.friend_now_playing_json);

  return {
    id: row.id,
    status: row.status,
    isIncoming,
    user,
    nowPlaying,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

router.get('/', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const userId = req.user.id;
    const rows = await db.query(
      `SELECT
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        u.id AS friend_id,
        u.username AS friend_username,
        u.display_name AS friend_display_name,
        u.avatar_url AS friend_avatar_url,
        u.bio AS friend_bio,
        u.static_id AS friend_static_id,
        u.created_at AS friend_created_at,
        u.is_admin AS friend_is_admin,
        u.now_playing_json AS friend_now_playing_json,
        u.privacy_hide_now_playing AS friend_privacy_hide_now_playing
       FROM friendships f
       JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
       WHERE f.requester_id = ? OR f.addressee_id = ?
       ORDER BY f.status ASC, f.created_at DESC`,
      [userId, userId, userId]
    );

    const friends = [];
    const incoming = [];
    const outgoing = [];

    rows.forEach((row) => {
      const item = formatFriendRow(row, userId);
      if (item.status === 'accepted') {
        friends.push(item);
      } else if (item.isIncoming) {
        incoming.push(item);
      } else {
        outgoing.push(item);
      }
    });

    res.json({ friends, incoming, outgoing });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить друзей' });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const query = String(req.query.q || '').trim().toLowerCase();
  if (query.length < 2) {
    return res.json([]);
  }

  try {
    const rows = await db.query(
      `SELECT id, username, display_name, avatar_url, bio, static_id, created_at, is_admin
       FROM users
       WHERE id != ?
         AND (privacy_hidden_account IS NULL OR privacy_hidden_account = 0)
         AND (username_lower LIKE ? OR display_name LIKE ?)
       ORDER BY username_lower ASC
       LIMIT 20`,
      [req.user.id, `${query}%`, `%${query}%`]
    );

    res.json(rows.map((row) => publicUser(row)));
  } catch {
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

router.post('/request', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const username = String(req.body?.username || '').trim().replace(/^@/, '');
  if (!username) {
    return res.status(400).json({ error: 'Укажите имя пользователя' });
  }

  try {
    const targetRows = await db.query(
      'SELECT * FROM users WHERE username_lower = ? LIMIT 1',
      [username.toLowerCase()]
    );
    const target = targetRows[0];
    if (!target) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя добавить себя' });
    }

    const existing = await db.query(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)
       LIMIT 1`,
      [req.user.id, target.id, target.id, req.user.id]
    );

    if (existing[0]) {
      if (existing[0].status === 'accepted') {
        return res.status(409).json({ error: 'Вы уже друзья' });
      }
      return res.status(409).json({ error: 'Заявка уже отправлена' });
    }

    const result = await db.query(
      'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)',
      [req.user.id, target.id, 'pending']
    );

    const rows = await db.query(
      `SELECT
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        u.id AS friend_id,
        u.username AS friend_username,
        u.display_name AS friend_display_name,
        u.avatar_url AS friend_avatar_url,
        u.bio AS friend_bio,
        u.static_id AS friend_static_id,
        u.created_at AS friend_created_at,
        u.is_admin AS friend_is_admin
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.id = ?`,
      [result.insertId]
    );

    res.status(201).json(formatFriendRow(rows[0], req.user.id));
  } catch {
    res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
});

router.post('/accept', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const friendshipId = Number(req.body?.friendshipId);
  if (!friendshipId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      'SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = ? LIMIT 1',
      [friendshipId, req.user.id, 'pending']
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    await db.query('UPDATE friendships SET status = ? WHERE id = ?', ['accepted', friendshipId]);

    const updated = await db.query(
      `SELECT
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        u.id AS friend_id,
        u.username AS friend_username,
        u.display_name AS friend_display_name,
        u.avatar_url AS friend_avatar_url,
        u.bio AS friend_bio,
        u.static_id AS friend_static_id,
        u.created_at AS friend_created_at,
        u.is_admin AS friend_is_admin
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.id = ?`,
      [friendshipId]
    );

    res.json(formatFriendRow(updated[0], req.user.id));
  } catch {
    res.status(500).json({ error: 'Не удалось принять заявку' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const friendshipId = Number(req.params.id);
  if (!friendshipId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      'SELECT * FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?) LIMIT 1',
      [friendshipId, req.user.id, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    await db.query('DELETE FROM friendships WHERE id = ?', [friendshipId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось удалить' });
  }
});

module.exports = { router };
