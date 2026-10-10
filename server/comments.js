const express = require('express');
const db = require('./db');
const { authMiddleware } = require('./auth');

const router = express.Router();
const MAX_MESSAGE_LENGTH = 400;

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function formatComment(row) {
  return {
    id: row.id,
    text: row.message || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatarUrl: row.avatar_url || '',
      isAdmin: Boolean(row.is_admin),
    },
  };
}

router.get('/api/tracks/:id/comments', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const trackId = String(req.params.id || '').trim();
  if (!/^\d+$/.test(trackId)) {
    return res.status(400).json({ error: 'Неверный трек' });
  }

  try {
    const rows = await db.query(
      `SELECT
        c.id,
        c.message,
        c.created_at,
        u.id AS user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_admin
       FROM track_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.track_id = ?
       ORDER BY c.id DESC
       LIMIT 40`,
      [trackId]
    );
    res.json(rows.reverse().map(formatComment));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить комментарии' });
  }
});

router.post('/api/tracks/:id/comments', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const trackId = String(req.params.id || '').trim();
  if (!/^\d+$/.test(trackId)) {
    return res.status(400).json({ error: 'Неверный трек' });
  }

  const text = String(req.body?.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Комментарий пустой' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Максимум ${MAX_MESSAGE_LENGTH} символов` });
  }

  try {
    const result = await db.query(
      'INSERT INTO track_comments (track_id, user_id, message) VALUES (?, ?, ?)',
      [trackId, req.user.id, text]
    );
    const rows = await db.query(
      `SELECT
        c.id,
        c.message,
        c.created_at,
        u.id AS user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_admin
       FROM track_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(formatComment(rows[0]));
  } catch {
    res.status(500).json({ error: 'Не удалось отправить комментарий' });
  }
});

module.exports = { router };
