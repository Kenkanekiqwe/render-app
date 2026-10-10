const express = require('express');

const db = require('./db');
const { authMiddleware } = require('./auth');
const { areFriends } = require('./privacy');

const router = express.Router();
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 60;
const VALID_TYPES = new Set(['text', 'sticker', 'gif']);

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function chatUser(row) {
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarUrl: row.avatar_url || '',
    isAdmin: Boolean(row.is_admin),
  };
}

function formatMessage(row) {
  const type = row.message_type || 'text';
  return {
    id: row.id,
    text: row.message || '',
    type,
    mediaUrl: row.media_url || '',
    stickerId: row.sticker_id || null,
    packId: row.pack_id || null,
    stickerImageUrl: row.sticker_image_url || '',
    packName: row.pack_name || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    user: chatUser(row),
  };
}

const MESSAGE_SELECT = `
  SELECT
    m.id,
    m.user_id,
    m.message,
    m.message_type,
    m.media_url,
    m.sticker_id,
    m.pack_id,
    m.created_at,
    u.username,
    u.display_name,
    u.avatar_url,
    u.is_admin,
    s.image_url AS sticker_image_url,
    p.name AS pack_name
  FROM chat_messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN stickers s ON s.id = m.sticker_id
  LEFT JOIN sticker_packs p ON p.id = m.pack_id
`;

async function userCanUseSticker(userId, stickerId) {
  const rows = await db.query(
    `SELECT s.id, s.pack_id, sp.user_id AS owner_id
     FROM stickers s
     JOIN sticker_packs sp ON sp.id = s.pack_id
     WHERE s.id = ?
     LIMIT 1`,
    [stickerId]
  );
  const row = rows[0];
  if (!row) return null;

  if (Number(row.owner_id) === Number(userId)) return row;

  const owned = await db.query(
    'SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = ? LIMIT 1',
    [userId, row.pack_id]
  );
  if (!owned.length) return null;
  return row;
}

router.get('/messages', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const before = Number(req.query.before) || null;
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  try {
    const params = [];
    let sql = MESSAGE_SELECT;

    if (before) {
      sql += ' WHERE m.id < ?';
      params.push(before);
    }

    sql += ` ORDER BY m.id DESC LIMIT ${limit}`;
    const rows = await db.query(sql, params);
    res.json(rows.reverse().map(formatMessage));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить сообщения' });
  }
});

router.post('/messages', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const type = String(req.body?.type || 'text').trim();
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Неверный тип сообщения' });
  }

  let text = '';
  let mediaUrl = null;
  let stickerId = null;
  let packId = null;

  if (type === 'text') {
    text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Сообщение пустое' });
    if (text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Максимум ${MAX_MESSAGE_LENGTH} символов` });
    }
  } else if (type === 'sticker') {
    stickerId = Number(req.body?.stickerId);
    if (!stickerId) return res.status(400).json({ error: 'Стикер не указан' });

    const stickerRow = await userCanUseSticker(req.user.id, stickerId);
    if (!stickerRow) {
      return res.status(403).json({ error: 'Добавьте набор в коллекцию' });
    }
    packId = stickerRow.pack_id;
    text = '[sticker]';
  } else if (type === 'gif') {
    mediaUrl = String(req.body?.mediaUrl || '').trim();
    if (!mediaUrl) return res.status(400).json({ error: 'URL GIF не указан' });
    if (mediaUrl.length > 2000) return res.status(400).json({ error: 'Слишком длинный URL' });
    if (!/^https?:\/\//i.test(mediaUrl) && !mediaUrl.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Неверный URL' });
    }
    text = '[gif]';
  }

  try {
    const result = await db.query(
      `INSERT INTO chat_messages
        (user_id, message, message_type, media_url, sticker_id, pack_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, text, type, mediaUrl, stickerId, packId]
    );

    const rows = await db.query(`${MESSAGE_SELECT} WHERE m.id = ?`, [result.insertId]);
    res.status(201).json(formatMessage(rows[0]));
  } catch {
    res.status(500).json({ error: 'Не удалось отправить сообщение' });
  }
});

const DM_SELECT = `
  SELECT
    m.id,
    m.sender_id AS user_id,
    m.message,
    m.message_type,
    m.media_url,
    m.sticker_id,
    m.pack_id,
    m.created_at,
    u.username,
    u.display_name,
    u.avatar_url,
    u.is_admin,
    s.image_url AS sticker_image_url,
    p.name AS pack_name
  FROM direct_messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN stickers s ON s.id = m.sticker_id
  LEFT JOIN sticker_packs p ON p.id = m.pack_id
`;

async function parseOutgoingPayload(req) {
  const type = String(req.body?.type || 'text').trim();
  if (!VALID_TYPES.has(type)) {
    return { error: 'Неверный тип сообщения', status: 400 };
  }

  let text = '';
  let mediaUrl = null;
  let stickerId = null;
  let packId = null;

  if (type === 'text') {
    text = String(req.body?.text || '').trim();
    if (!text) return { error: 'Сообщение пустое', status: 400 };
    if (text.length > MAX_MESSAGE_LENGTH) {
      return { error: `Максимум ${MAX_MESSAGE_LENGTH} символов`, status: 400 };
    }
  } else if (type === 'sticker') {
    stickerId = Number(req.body?.stickerId);
    if (!stickerId) return { error: 'Стикер не указан', status: 400 };
    const stickerRow = await userCanUseSticker(req.user.id, stickerId);
    if (!stickerRow) {
      return { error: 'Добавьте набор в коллекцию', status: 403 };
    }
    packId = stickerRow.pack_id;
    text = '[sticker]';
  } else if (type === 'gif') {
    mediaUrl = String(req.body?.mediaUrl || '').trim();
    if (!mediaUrl) return { error: 'URL GIF не указан', status: 400 };
    if (mediaUrl.length > 2000) return { error: 'Слишком длинный URL', status: 400 };
    if (!/^https?:\/\//i.test(mediaUrl) && !mediaUrl.startsWith('/uploads/')) {
      return { error: 'Неверный URL', status: 400 };
    }
    text = '[gif]';
  }

  return { type, text, mediaUrl, stickerId, packId };
}

router.get('/dm', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const peerId = Number(req.query.userId);
  if (!peerId || peerId === req.user.id) {
    return res.status(400).json({ error: 'Укажите пользователя' });
  }

  try {
    if (!(await areFriends(req.user.id, peerId))) {
      return res.status(403).json({ error: 'Переписка только с друзьями' });
    }

    const before = Number(req.query.before) || null;
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const params = [req.user.id, peerId, peerId, req.user.id];
    let sql = `${DM_SELECT} WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`;
    if (before) {
      sql += ' AND m.id < ?';
      params.push(before);
    }
    sql += ` ORDER BY m.id DESC LIMIT ${limit}`;
    const rows = await db.query(sql, params);
    res.json(rows.reverse().map(formatMessage));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить переписку' });
  }
});

router.post('/dm', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const peerId = Number(req.body?.userId);
  if (!peerId || peerId === req.user.id) {
    return res.status(400).json({ error: 'Укажите пользователя' });
  }

  try {
    if (!(await areFriends(req.user.id, peerId))) {
      return res.status(403).json({ error: 'Переписка только с друзьями' });
    }

    const payload = await parseOutgoingPayload(req);
    if (payload.error) {
      return res.status(payload.status).json({ error: payload.error });
    }

    const result = await db.query(
      `INSERT INTO direct_messages
        (sender_id, recipient_id, message, message_type, media_url, sticker_id, pack_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        peerId,
        payload.text,
        payload.type,
        payload.mediaUrl,
        payload.stickerId,
        payload.packId,
      ]
    );

    const rows = await db.query(`${DM_SELECT} WHERE m.id = ?`, [result.insertId]);
    res.status(201).json(formatMessage(rows[0]));
  } catch {
    res.status(500).json({ error: 'Не удалось отправить сообщение' });
  }
});

module.exports = { router };
