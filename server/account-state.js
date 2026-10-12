const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const { authMiddleware } = require('./auth');

const router = express.Router();
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_BACKGROUND_BYTES = 16 * 1024 * 1024;
const uploadsRoot = path.join(__dirname, '..', 'uploads', 'backgrounds');
fs.mkdirSync(uploadsRoot, { recursive: true });

const imageMimeToExt = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsRoot),
  filename: (_req, file, cb) => {
    const ext = imageMimeToExt[file.mimetype];
    if (!ext) return cb(new Error('Поддерживаются JPG, PNG, WEBP, GIF и AVIF'));
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploadBackground = multer({
  storage,
  limits: { fileSize: MAX_BACKGROUND_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!imageMimeToExt[file.mimetype]) {
      return cb(new Error('Поддерживаются только изображения JPG, PNG, WEBP, GIF и AVIF'));
    }
    return cb(null, true);
  },
});

function cleanLocalStorage(input, userId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allowedGlobals = new Set([
    'render_app_settings',
    'render_player',
    'render_playback_session',
    'render_call_audio_settings',
    'render_call_screen_settings',
    'render_custom_incoming_ringtone_name',
  ]);
  const prefix = `render_u${userId}_`;
  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key.startsWith(prefix) || allowedGlobals.has(key))) continue;
    if (typeof value !== 'string') continue;
    if (value.length > 5 * 1024 * 1024) continue;
    clean[key] = value;
  }
  return clean;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await db.query('SELECT state_json FROM user_account_state WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!rows[0]?.state_json) return res.json({ state: null });
    try {
      return res.json({ state: JSON.parse(rows[0].state_json) });
    } catch {
      return res.json({ state: null });
    }
  } catch (error) {
    console.error('[account-state] load failed:', error.message);
    return res.status(500).json({ error: 'Не удалось загрузить данные аккаунта' });
  }
});

router.put('/', authMiddleware, async (req, res) => {
  const incoming = req.body?.state;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Неверный формат данных аккаунта' });
  }
  const state = {
    version: 1,
    localStorage: cleanLocalStorage(incoming.localStorage, req.user.id),
    updatedAt: Date.now(),
  };
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) {
    return res.status(413).json({ error: 'Данные аккаунта слишком большие' });
  }
  try {
    await db.query(
      `INSERT INTO user_account_state (user_id, state_json) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, json]
    );
    return res.json({ ok: true, state });
  } catch (error) {
    console.error('[account-state] save failed:', error.message);
    return res.status(500).json({ error: 'Не удалось сохранить данные аккаунта' });
  }
});

router.post('/background', authMiddleware, (req, res) => {
  uploadBackground.single('background')(req, res, async (error) => {
    if (error) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? 'Фон должен быть не больше 16 МБ'
          : (error.message || 'Не удалось загрузить изображение'),
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Выбери файл изображения' });
    const url = `/uploads/backgrounds/${req.file.filename}`;
    try {
      await db.query('UPDATE users SET background_url = ? WHERE id = ?', [url, req.user.id]);
      return res.json({ url });
    } catch (saveError) {
      fs.unlink(req.file.path, () => {});
      console.error('[account-state] background save failed:', saveError.message);
      return res.status(500).json({ error: 'Не удалось сохранить фон в аккаунте' });
    }
  });
});

module.exports = { router };