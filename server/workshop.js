const express = require('express');
const db = require('./db');
const { authMiddleware, publicUser } = require('./auth');

const router = express.Router();
const VALID_TYPES = new Set(['background', 'banner', 'avatar']);
const MAX_TITLE = 120;
const MAX_DESC = 500;

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatWorkshopItem(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.item_type,
    url: row.url,
    description: row.description || '',
    usesCount: row.uses_count || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    author: publicUser({
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      bio: row.bio,
      static_id: row.static_id,
      created_at: row.user_created_at,
    }),
  };
}

router.get('/', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const type = String(req.query.type || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);

  try {
    const params = [];
    let sql = `
      SELECT
        w.id,
        w.user_id,
        w.title,
        w.item_type,
        w.url,
        w.description,
        w.uses_count,
        w.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.bio,
        u.static_id,
        u.created_at AS user_created_at
      FROM workshop_items w
      JOIN users u ON u.id = w.user_id
    `;

    if (type && VALID_TYPES.has(type)) {
      sql += ' WHERE w.item_type = ?';
      params.push(type);
    }

    sql += ` ORDER BY w.created_at DESC LIMIT ${limit}`;
    const rows = await db.query(sql, params);
    res.json(rows.map(formatWorkshopItem));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить мастерскую' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const title = String(req.body?.title || '').trim().slice(0, MAX_TITLE);
  const type = String(req.body?.type || 'background').trim();
  const url = String(req.body?.url || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, MAX_DESC);

  if (!title) {
    return res.status(400).json({ error: 'Укажите название' });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Неверный тип' });
  }
  if (!isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'Некорректный URL' });
  }

  try {
    const result = await db.query(
      `INSERT INTO workshop_items (user_id, title, item_type, url, description)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, title, type, url, description || null]
    );

    const rows = await db.query(
      `SELECT
        w.id,
        w.user_id,
        w.title,
        w.item_type,
        w.url,
        w.description,
        w.uses_count,
        w.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.bio,
        u.static_id,
        u.created_at AS user_created_at
       FROM workshop_items w
       JOIN users u ON u.id = w.user_id
       WHERE w.id = ?`,
      [result.insertId]
    );

    res.status(201).json(formatWorkshopItem(rows[0]));
  } catch {
    res.status(500).json({ error: 'Не удалось опубликовать' });
  }
});

router.post('/:id/apply', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const itemId = Number(req.params.id);
  if (!itemId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      'SELECT id, item_type, url FROM workshop_items WHERE id = ? LIMIT 1',
      [itemId]
    );
    const item = rows[0];
    if (!item) {
      return res.status(404).json({ error: 'Элемент не найден' });
    }

    await db.query('UPDATE workshop_items SET uses_count = uses_count + 1 WHERE id = ?', [itemId]);

    res.json({
      ok: true,
      type: item.item_type,
      url: item.url,
    });
  } catch {
    res.status(500).json({ error: 'Не удалось применить' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const itemId = Number(req.params.id);
  if (!itemId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      'SELECT id FROM workshop_items WHERE id = ? AND user_id = ? LIMIT 1',
      [itemId, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Элемент не найден' });
    }

    await db.query('DELETE FROM workshop_items WHERE id = ?', [itemId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось удалить' });
  }
});

module.exports = { router };
