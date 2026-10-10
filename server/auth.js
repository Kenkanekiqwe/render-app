const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const { grantEarlyUserBadge } = require('./badges');
const { createCaptcha, verifyCaptcha } = require('./captcha');
const { privacyFromRow, parsePrivacyBody } = require('./privacy');
const { getUserPlaylists, syncUserPlaylists } = require('./user-playlists');
const { loadEquippedCosmetics } = require('./cosmetics');
const {
  normalizeTrack,
  profileExtrasFromRow,
  normalizeProfileLinks,
} = require('./profile-extras');

const router = express.Router();

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '30d';
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getJwtSecret() {
  return process.env.JWT_SECRET || 'render-dev-jwt-secret-change-me';
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
  });
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    displayName: row.display_name,
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    staticId: row.static_id != null ? String(row.static_id) : '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    isAdmin: Boolean(row.is_admin),
  };
}

function publicProfile(row, { includePrivacy = false, includeNowPlaying = false, includeWallet = false, equippedCosmetics = null } = {}) {
  if (!row) return null;
  const profile = {
    ...publicUser(row),
    bannerUrl: row.banner_url || '',
    bannerPositionY: Number(row.banner_position_y ?? 50),
    bannerHeight: Number(row.banner_height ?? 200),
    bannerOverlay: Number(row.banner_overlay ?? 0),
    backgroundUrl: row.background_url || '',
    ...profileExtrasFromRow(row, { includeNowPlaying, allowStaleNowPlaying: includeNowPlaying }),
  };
  if (includeWallet) {
    profile.renderCoins = Number(row.render_coins) || 0;
  }
  if (equippedCosmetics) {
    profile.equippedCosmetics = equippedCosmetics;
  }
  if (includePrivacy) {
    profile.privacy = privacyFromRow(row);
  }
  return profile;
}

async function profileForAuth(user, { includeNowPlaying = false } = {}) {
  const equipped = await loadEquippedCosmetics(user.id);
  const profile = publicProfile(user, {
    includePrivacy: true,
    includeNowPlaying,
    includeWallet: true,
    equippedCosmetics: equipped,
  });
  profile.isAdmin = Boolean(user.is_admin);
  return profile;
}

async function findByUsername(usernameLower) {
  const rows = await db.query('SELECT * FROM users WHERE username_lower = ? LIMIT 1', [usernameLower]);
  return rows[0] || null;
}

async function findByLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  const rows = await db.query(
    'SELECT * FROM users WHERE username_lower = ? OR email_lower = ? LIMIT 1',
    [value, value]
  );
  return rows[0] || null;
}

async function findById(id) {
  const rows = await db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна. Проверьте настройки MariaDB.' });
    return false;
  }
  return true;
}

/** Express middleware: attach req.user when a valid Bearer token is present. */
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!db.isReady()) {
      return res.status(503).json({ error: 'База данных недоступна' });
    }
    const user = await findById(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: 'Аккаунт заблокирован', banned: true });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

router.get('/captcha', (req, res) => {
  const captcha = createCaptcha();
  res.json(captcha);
});

router.post('/register', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || '').trim() || username;
  const captchaToken = req.body?.captchaToken;
  const captchaAnswer = req.body?.captchaAnswer;

  if (!verifyCaptcha(captchaToken, captchaAnswer)) {
    return res.status(400).json({ error: 'Неверная капча', field: 'captcha' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: 'Имя пользователя: 3-32 символа, буквы, цифры, _ и .',
      field: 'username',
    });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Некорректный email', field: 'email' });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: 'Пароль: от 6 до 128 символов', field: 'password' });
  }
  if (displayName.length > 64) {
    return res.status(400).json({ error: 'Отображаемое имя слишком длинное', field: 'displayName' });
  }

  try {
    const usernameLower = username.toLowerCase();
    const emailLower = email ? email.toLowerCase() : null;

    if (await findByUsername(usernameLower)) {
      return res.status(409).json({ error: 'Имя пользователя занято', field: 'username' });
    }
    if (emailLower) {
      const rows = await db.query('SELECT id FROM users WHERE email_lower = ? LIMIT 1', [emailLower]);
      if (rows[0]) {
        return res.status(409).json({ error: 'Email уже используется', field: 'email' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users
        (username, username_lower, email, email_lower, password_hash, display_name, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [username, usernameLower, email || null, emailLower, passwordHash, displayName]
    );

    const userId = result.insertId;

    // Sequential static id that mirrors the auto-increment user id (starts at 1).
    try {
      await db.query('UPDATE users SET static_id = ? WHERE id = ?', [userId, userId]);
    } catch (error) {
      console.warn('[auth] static_id update failed:', error.message);
    }

    try {
      await grantEarlyUserBadge(userId);
    } catch (error) {
      console.warn('[auth] early badge grant failed:', error.message);
    }

    const user = await findById(userId);
    if (!user) {
      return res.status(500).json({ error: 'Аккаунт создан, но не удалось загрузить профиль. Войдите.' });
    }

    const token = signToken(user);
    let profile;
    try {
      profile = await profileForAuth(user);
    } catch (error) {
      console.warn('[auth] profile enrich failed:', error.message);
      profile = publicProfile(user, { includePrivacy: true, includeWallet: true });
      profile.isAdmin = Boolean(user.is_admin);
      profile.equippedCosmetics = null;
    }

    return res.status(201).json({ token, user: profile });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Такой пользователь уже существует' });
    }
    console.error('[auth] register failed:', error);
    return res.status(500).json({ error: 'Не удалось создать аккаунт' });
  }
});

router.post('/login', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const login = String(req.body?.login || '').trim();
  const password = String(req.body?.password || '');
  const captchaToken = req.body?.captchaToken;
  const captchaAnswer = req.body?.captchaAnswer;

  if (!verifyCaptcha(captchaToken, captchaAnswer)) {
    return res.status(400).json({ error: 'Неверная капча', field: 'captcha' });
  }
  if (!login || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  try {
    const user = await findByLogin(login);
    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: 'Аккаунт заблокирован', banned: true });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const token = signToken(user);
    const freshUser = await findById(user.id);
    return res.json({ token, user: await profileForAuth(freshUser) });
  } catch {
    return res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    res.json({ user: await profileForAuth(req.user, { includeNowPlaying: true }) });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить профиль' });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  const displayName = req.body?.displayName != null ? String(req.body.displayName).trim() : null;
  const usernameRaw = req.body?.username != null ? String(req.body.username).trim().replace(/^@/, '') : null;
  const avatarUrl = req.body?.avatarUrl != null ? String(req.body.avatarUrl) : null;
  const bio = req.body?.bio != null ? String(req.body.bio).slice(0, 500) : null;
  const bannerUrl = req.body?.bannerUrl != null ? String(req.body.bannerUrl) : null;
  const bannerPositionY =
    req.body?.bannerPositionY != null ? Number(req.body.bannerPositionY) : null;
  const bannerHeight = req.body?.bannerHeight != null ? Number(req.body.bannerHeight) : null;
  const bannerOverlay = req.body?.bannerOverlay != null ? Number(req.body.bannerOverlay) : null;
  const backgroundUrl = req.body?.backgroundUrl != null ? String(req.body.backgroundUrl) : null;
  const hasPinnedTrack = Object.prototype.hasOwnProperty.call(req.body || {}, 'pinnedTrack');
  const hasLinks = Object.prototype.hasOwnProperty.call(req.body || {}, 'links');

  if (displayName != null && (displayName.length < 1 || displayName.length > 64)) {
    return res.status(400).json({ error: 'Отображаемое имя: 1-64 символа', field: 'displayName' });
  }
  if (usernameRaw != null) {
    if (!USERNAME_RE.test(usernameRaw)) {
      return res.status(400).json({
        error: 'Имя пользователя: 3-32 символа, латиница, цифры, _ и .',
        field: 'username',
      });
    }
    const usernameLower = usernameRaw.toLowerCase();
    const existing = await findByUsername(usernameLower);
    if (existing && Number(existing.id) !== Number(req.user.id)) {
      return res.status(409).json({ error: 'Имя пользователя занято', field: 'username' });
    }
  }
  if (bannerPositionY != null && (bannerPositionY < 0 || bannerPositionY > 100)) {
    return res.status(400).json({ error: 'Неверная позиция баннера', field: 'bannerPositionY' });
  }
  if (bannerHeight != null && (bannerHeight < 120 || bannerHeight > 400)) {
    return res.status(400).json({ error: 'Неверная высота баннера', field: 'bannerHeight' });
  }
  if (bannerOverlay != null && (bannerOverlay < 0 || bannerOverlay > 80)) {
    return res.status(400).json({ error: 'Неверное затемнение баннера', field: 'bannerOverlay' });
  }

  try {
    const sets = [
      'display_name = COALESCE(?, display_name)',
      'avatar_url = COALESCE(?, avatar_url)',
      'bio = COALESCE(?, bio)',
      'banner_url = COALESCE(?, banner_url)',
      'banner_position_y = COALESCE(?, banner_position_y)',
      'banner_height = COALESCE(?, banner_height)',
      'banner_overlay = COALESCE(?, banner_overlay)',
      'background_url = COALESCE(?, background_url)',
    ];
    const values = [
      displayName,
      avatarUrl,
      bio,
      bannerUrl,
      bannerPositionY,
      bannerHeight,
      bannerOverlay,
      backgroundUrl,
    ];

    if (usernameRaw != null) {
      sets.push('username = ?', 'username_lower = ?');
      values.push(usernameRaw, usernameRaw.toLowerCase());
    }

    if (hasPinnedTrack) {
      sets.push('pinned_track_json = ?');
      values.push(
        req.body.pinnedTrack ? JSON.stringify(normalizeTrack(req.body.pinnedTrack)) : null
      );
    }

    values.push(req.user.id);
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);

    if (hasLinks) {
      const linksJson = JSON.stringify(normalizeProfileLinks(req.body.links));
      try {
        await db.query('UPDATE users SET profile_links_json = ? WHERE id = ?', [linksJson, req.user.id]);
      } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR' || error.errno === 1054) {
          await db.query('ALTER TABLE users ADD COLUMN profile_links_json TEXT NULL');
          await db.query('UPDATE users SET profile_links_json = ? WHERE id = ?', [linksJson, req.user.id]);
        } else {
          throw error;
        }
      }
    }

    const user = await findById(req.user.id);
    const profile = await profileForAuth(user, { includeNowPlaying: true });
    if (hasLinks) {
      profile.links = normalizeProfileLinks(req.body.links);
    }
    return res.json({ user: profile });
  } catch (error) {
    console.error('profile update failed:', error);
    return res.status(500).json({ error: 'Не удалось обновить профиль' });
  }
});

router.put('/privacy', authMiddleware, async (req, res) => {
  const updates = parsePrivacyBody(req.body);
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Нет настроек для обновления' });
  }

  const columnMap = {
    hiddenAccount: 'privacy_hidden_account',
    hideCreatedAt: 'privacy_hide_created_at',
    hidePlaylists: 'privacy_hide_playlists',
    hideAvatar: 'privacy_hide_avatar',
    hideBanner: 'privacy_hide_banner',
    hideNowPlaying: 'privacy_hide_now_playing',
  };

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] != null) {
      sets.push(`${column} = ?`);
      values.push(updates[key] ? 1 : 0);
    }
  }

  try {
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, req.user.id]);
    const user = await findById(req.user.id);
    return res.json({ user: publicProfile(user, { includePrivacy: true }) });
  } catch {
    return res.status(500).json({ error: 'Не удалось обновить настройки приватности' });
  }
});

router.get('/playlists', authMiddleware, async (req, res) => {
  try {
    const playlists = await getUserPlaylists(req.user.id);
    return res.json({ playlists });
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить плейлисты' });
  }
});

router.put('/playlists', authMiddleware, async (req, res) => {
  if (!Array.isArray(req.body?.playlists)) {
    return res.status(400).json({ error: 'Неверный формат плейлистов' });
  }

  try {
    const playlists = await syncUserPlaylists(req.user.id, req.body.playlists);
    return res.json({ playlists });
  } catch {
    return res.status(500).json({ error: 'Не удалось сохранить плейлисты' });
  }
});

router.post('/now-playing', authMiddleware, async (req, res) => {
  try {
    const track = normalizeTrack(req.body?.track);
    const isPlaying = Boolean(req.body?.isPlaying);

    if (!track) {
      await db.query('UPDATE users SET now_playing_json = NULL WHERE id = ?', [req.user.id]);
      return res.json({ ok: true, cleared: true });
    }

    const payload = JSON.stringify({
      track,
      isPlaying,
      updatedAt: Date.now(),
    });

    await db.query('UPDATE users SET now_playing_json = ? WHERE id = ?', [payload, req.user.id]);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Не удалось обновить статус воспроизведения' });
  }
});

module.exports = {
  router,
  authMiddleware,
  publicUser,
  publicProfile,
  findById,
};
