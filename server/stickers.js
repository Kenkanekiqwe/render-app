const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const { authMiddleware } = require('./auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'stickers');
const MAX_STICKERS_PER_PACK = 120;
const MAX_PACKS_PER_USER = 40;

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('INVALID_TYPE'), ok);
  },
});

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function formatSticker(row) {
  return {
    id: row.id,
    packId: row.pack_id,
    imageUrl: row.image_url,
    label: row.label || '',
    sortOrder: row.sort_order || 0,
  };
}

function formatPack(row, stickers = []) {
  return {
    id: row.id,
    name: row.name,
    coverUrl: row.cover_url || stickers[0]?.imageUrl || '',
    ownerId: row.user_id,
    ownerName: row.owner_name || row.display_name || row.username || '',
    stickerCount: row.sticker_count ?? stickers.length,
    isOwned: Boolean(row.is_owned),
    isInCollection: Boolean(row.in_collection),
    stickers,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

async function getPackRow(packId) {
  const rows = await db.query(
    `SELECT p.*, u.username, u.display_name
     FROM sticker_packs p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?
     LIMIT 1`,
    [packId]
  );
  return rows[0] || null;
}

async function loadPackStickers(packId) {
  const rows = await db.query(
    'SELECT * FROM stickers WHERE pack_id = ? ORDER BY sort_order ASC, id ASC',
    [packId]
  );
  return rows.map(formatSticker);
}

router.get('/packs', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const rows = await db.query(
      `SELECT
        p.*,
        u.username,
        u.display_name,
        (SELECT COUNT(*) FROM stickers s WHERE s.pack_id = p.id) AS sticker_count,
        (p.user_id = ?) AS is_owned,
        EXISTS(
          SELECT 1 FROM user_sticker_packs usp
          WHERE usp.user_id = ? AND usp.pack_id = p.id
        ) AS in_collection
       FROM sticker_packs p
       JOIN users u ON u.id = p.user_id
       WHERE p.is_public = 1 OR p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT 80`,
      [req.user.id, req.user.id, req.user.id]
    );

    res.json(rows.map((row) => formatPack(row)));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить стикеры' });
  }
});

router.get('/my', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const rows = await db.query(
      `SELECT
        p.*,
        u.username,
        u.display_name,
        (SELECT COUNT(*) FROM stickers s WHERE s.pack_id = p.id) AS sticker_count,
        1 AS in_collection,
        (p.user_id = ?) AS is_owned
       FROM user_sticker_packs usp
       JOIN sticker_packs p ON p.id = usp.pack_id
       JOIN users u ON u.id = p.user_id
       WHERE usp.user_id = ?
       ORDER BY usp.added_at DESC`,
      [req.user.id, req.user.id]
    );

    const packs = await Promise.all(
      rows.map(async (row) => formatPack(row, await loadPackStickers(row.id)))
    );

    res.json(packs);
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить коллекцию' });
  }
});

router.get('/packs/:packId', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const packId = Number(req.params.packId);
  if (!packId) return res.status(400).json({ error: 'Неверный набор' });

  try {
    const rows = await db.query(
      `SELECT
        p.*,
        u.username,
        u.display_name,
        (SELECT COUNT(*) FROM stickers s WHERE s.pack_id = p.id) AS sticker_count,
        (p.user_id = ?) AS is_owned,
        EXISTS(
          SELECT 1 FROM user_sticker_packs usp
          WHERE usp.user_id = ? AND usp.pack_id = p.id
        ) AS in_collection
       FROM sticker_packs p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ? AND (p.is_public = 1 OR p.user_id = ?)
       LIMIT 1`,
      [req.user.id, req.user.id, packId, req.user.id]
    );

    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Набор не найден' });

    const stickers = await loadPackStickers(packId);
    res.json(formatPack(row, stickers));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить набор' });
  }
});

router.post('/packs', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const name = String(req.body?.name || '').trim().slice(0, 64);
  if (!name) return res.status(400).json({ error: 'Укажите название набора' });

  try {
    const countRows = await db.query(
      'SELECT COUNT(*) AS c FROM sticker_packs WHERE user_id = ?',
      [req.user.id]
    );
    if ((countRows[0]?.c || 0) >= MAX_PACKS_PER_USER) {
      return res.status(400).json({ error: 'Слишком много наборов' });
    }

    const result = await db.query(
      'INSERT INTO sticker_packs (user_id, name, is_public) VALUES (?, ?, 1)',
      [req.user.id, name]
    );

    await db.query(
      'INSERT INTO user_sticker_packs (user_id, pack_id) VALUES (?, ?)',
      [req.user.id, result.insertId]
    );

    const pack = await getPackRow(result.insertId);
    res.status(201).json(formatPack({ ...pack, is_owned: 1, in_collection: 1, sticker_count: 0 }, []));
  } catch {
    res.status(500).json({ error: 'Не удалось создать набор' });
  }
});

router.post('/packs/:packId/stickers', authMiddleware, upload.single('image'), async (req, res) => {
  if (!ensureDbReady(res)) return;

  const packId = Number(req.params.packId);
  if (!packId) return res.status(400).json({ error: 'Неверный набор' });

  try {
    const pack = await getPackRow(packId);
    if (!pack || Number(pack.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Можно добавлять только в свои наборы' });
    }

    let imageUrl = '';
    if (req.file) {
      imageUrl = `/uploads/stickers/${req.file.filename}`;
    } else {
      imageUrl = String(req.body?.imageUrl || '').trim();
    }

    if (!imageUrl) return res.status(400).json({ error: 'Нужно изображение' });
    if (imageUrl.length > 2000) return res.status(400).json({ error: 'Слишком длинный URL' });

    const countRows = await db.query(
      'SELECT COUNT(*) AS c FROM stickers WHERE pack_id = ?',
      [packId]
    );
    if ((countRows[0]?.c || 0) >= MAX_STICKERS_PER_PACK) {
      return res.status(400).json({ error: 'Слишком много стикеров в наборе' });
    }

    const label = String(req.body?.label || '').trim().slice(0, 32);
    const sortOrder = Number(req.body?.sortOrder) || 0;

    const result = await db.query(
      'INSERT INTO stickers (pack_id, image_url, label, sort_order) VALUES (?, ?, ?, ?)',
      [packId, imageUrl, label, sortOrder]
    );

    if (!pack.cover_url) {
      await db.query('UPDATE sticker_packs SET cover_url = ? WHERE id = ?', [imageUrl, packId]);
    }

    const rows = await db.query('SELECT * FROM stickers WHERE id = ? LIMIT 1', [result.insertId]);
    res.status(201).json(formatSticker(rows[0]));
  } catch (error) {
    if (error.message === 'INVALID_TYPE') {
      return res.status(400).json({ error: 'Поддерживаются PNG, JPG, GIF, WebP' });
    }
    res.status(500).json({ error: 'Не удалось добавить стикер' });
  }
});

router.post('/packs/:packId/add', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const packId = Number(req.params.packId);
  if (!packId) return res.status(400).json({ error: 'Неверный набор' });

  try {
    const rows = await db.query(
      'SELECT id, is_public, user_id FROM sticker_packs WHERE id = ? LIMIT 1',
      [packId]
    );
    const pack = rows[0];
    if (!pack) return res.status(404).json({ error: 'Набор не найден' });
    if (!pack.is_public && Number(pack.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Набор недоступен' });
    }

    await db.query(
      'INSERT IGNORE INTO user_sticker_packs (user_id, pack_id) VALUES (?, ?)',
      [req.user.id, packId]
    );

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось добавить набор' });
  }
});

router.delete('/packs/:packId/remove', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const packId = Number(req.params.packId);
  if (!packId) return res.status(400).json({ error: 'Неверный набор' });

  try {
    await db.query(
      'DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?',
      [req.user.id, packId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось удалить из коллекции' });
  }
});

module.exports = { router, UPLOAD_DIR };
