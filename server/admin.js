const express = require('express');
const db = require('./db');
const { authMiddleware, publicUser, findById } = require('./auth');
const { formatCatalogItem, formatInstance, parseCustomization, parseAsset, canCustomizeBadgeLabel } = require('./cosmetics');

const router = express.Router();

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

function isAdminUser(row) {
  return Boolean(row?.is_admin);
}

function adminMiddleware(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Доступ только для администраторов' });
  }
  return next();
}

function parseUserId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function adminUserRow(row) {
  if (!row) return null;
  return {
    ...publicUser(row),
    isAdmin: Boolean(row.is_admin),
    isBanned: Boolean(row.is_banned),
    bannedAt: row.banned_at ? new Date(row.banned_at).getTime() : null,
    banReason: row.ban_reason || '',
    renderCoins: Number(row.render_coins) || 0,
    email: row.email || '',
  };
}

async function clearEquippedIfMatches(userId, instanceId) {
  await db.query(
    `UPDATE users SET
      equipped_frame_instance_id = IF(equipped_frame_instance_id = ?, NULL, equipped_frame_instance_id),
      equipped_name_color_instance_id = IF(equipped_name_color_instance_id = ?, NULL, equipped_name_color_instance_id),
      equipped_badge_instance_id = IF(equipped_badge_instance_id = ?, NULL, equipped_badge_instance_id),
      equipped_badge_2_instance_id = IF(equipped_badge_2_instance_id = ?, NULL, equipped_badge_2_instance_id)
    WHERE id = ?`,
    [instanceId, instanceId, instanceId, instanceId, userId]
  );
}

router.use(authMiddleware, adminMiddleware);

router.get('/users', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);

  try {
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = await db.query(
        `SELECT id, username, display_name, email, avatar_url, bio, static_id, created_at,
                is_admin, is_banned, banned_at, ban_reason, render_coins
         FROM users
         WHERE username_lower LIKE ? OR email_lower LIKE ? OR CAST(id AS CHAR) LIKE ? OR CAST(static_id AS CHAR) LIKE ?
         ORDER BY id ASC
         LIMIT ?`,
        [like, like, like, like, limit]
      );
    } else {
      rows = await db.query(
        `SELECT id, username, display_name, email, avatar_url, bio, static_id, created_at,
                is_admin, is_banned, banned_at, ban_reason, render_coins
         FROM users
         ORDER BY id ASC
         LIMIT ?`,
        [limit]
      );
    }

    res.json({ users: rows.map(adminUserRow) });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить пользователей' });
  }
});

router.get('/users/:id', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const itemRows = await db.query(
      `SELECT
        i.id AS instance_id,
        i.item_id,
        i.acquired_at,
        i.source,
        i.listed_at,
        i.listing_price,
        c.id, c.slug, c.name, c.item_type, c.asset_json, c.price_coins, c.is_tradable, c.sort_order
      FROM user_item_instances i
      JOIN marketplace_items c ON c.id = i.item_id
      WHERE i.user_id = ?
      ORDER BY i.acquired_at DESC`,
      [userId]
    );

    res.json({
      user: adminUserRow(user),
      items: itemRows.map(formatInstance),
    });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить пользователя' });
  }
});

router.get('/catalog', async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const rows = await db.query('SELECT * FROM marketplace_items ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(formatCatalogItem));
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить каталог' });
  }
});

router.post('/users/:id/ban', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Нельзя заблокировать себя' });
  }

  const reason = String(req.body?.reason || '').trim().slice(0, 500);

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.query(
      'UPDATE users SET is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?',
      [reason || null, userId]
    );

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось заблокировать пользователя' });
  }
});

router.post('/users/:id/unban', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }

  try {
    const result = await db.query(
      'UPDATE users SET is_banned = 0, banned_at = NULL, ban_reason = NULL WHERE id = ?',
      [userId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось разблокировать пользователя' });
  }
});

router.delete('/users/:id', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
  }

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось удалить пользователя' });
  }
});

router.post('/users/:id/coins', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  const amount = Number(req.body?.amount);
  const mode = String(req.body?.mode || 'add').trim();

  if (!userId || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const current = Number(user.render_coins) || 0;
    let next = current;

    if (mode === 'set') {
      next = Math.floor(amount);
    } else if (mode === 'take') {
      next = Math.max(0, current - Math.floor(amount));
    } else {
      next = current + Math.floor(amount);
    }

    await db.query('UPDATE users SET render_coins = ? WHERE id = ?', [next, userId]);
    res.json({ ok: true, renderCoins: next });
  } catch {
    res.status(500).json({ error: 'Не удалось изменить баланс' });
  }
});

router.post('/users/:id/grant-item', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  const itemId = Number(req.body?.itemId);

  if (!userId || !itemId) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const catalogRows = await db.query('SELECT * FROM marketplace_items WHERE id = ? LIMIT 1', [itemId]);
    if (!catalogRows[0]) {
      return res.status(404).json({ error: 'Предмет не найден' });
    }

    const insert = await db.query(
      'INSERT INTO user_item_instances (user_id, item_id, source) VALUES (?, ?, ?)',
      [userId, itemId, 'grant']
    );

    res.status(201).json({ ok: true, instanceId: insert.insertId });
  } catch {
    res.status(500).json({ error: 'Не удалось выдать предмет' });
  }
});

router.delete('/users/:id/items/:instanceId', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  const instanceId = parseUserId(req.params.instanceId);

  if (!userId || !instanceId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      'SELECT id FROM user_item_instances WHERE id = ? AND user_id = ? LIMIT 1',
      [instanceId, userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Предмет не найден' });
    }

    await clearEquippedIfMatches(userId, instanceId);
    await db.query('DELETE FROM user_item_instances WHERE id = ? AND user_id = ?', [instanceId, userId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось изъять предмет' });
  }
});

router.post('/users/:id/admin', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }

  try {
    const user = await findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось выдать права админа' });
  }
});

router.delete('/users/:id/admin', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'Неверный пользователь' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Нельзя снять права с себя' });
  }

  try {
    const admins = await db.query('SELECT id FROM users WHERE is_admin = 1');
    if (admins.length <= 1 && admins.some((row) => Number(row.id) === userId)) {
      return res.status(400).json({ error: 'Нельзя снять права у последнего администратора' });
    }

    const result = await db.query('UPDATE users SET is_admin = 0 WHERE id = ?', [userId]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось снять права админа' });
  }
});

router.get('/badge-labels/pending', async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const rows = await db.query(
      `SELECT
        i.id AS instance_id,
        i.customization_json,
        i.user_id,
        c.slug,
        c.name,
        c.item_type,
        c.asset_json,
        u.username,
        u.display_name
      FROM user_item_instances i
      JOIN marketplace_items c ON c.id = i.item_id
      JOIN users u ON u.id = i.user_id
      WHERE c.item_type = 'badge' AND c.slug LIKE '%-custom'
      ORDER BY i.id DESC
      LIMIT 200`
    );

    const pending = rows
      .map((row) => {
        const customization = parseCustomization(row.customization_json);
        if (!canCustomizeBadgeLabel(row)) {
          return null;
        }
        if (customization.customLabelStatus !== 'pending' || !customization.customLabel) {
          return null;
        }
        const item = formatCatalogItem(row);
        return {
          instanceId: row.instance_id,
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          customLabel: customization.customLabel,
          submittedAt: customization.customLabelSubmittedAt || null,
          item,
        };
      })
      .filter(Boolean);

    res.json({ items: pending });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить заявки' });
  }
});

router.post('/badge-labels/:instanceId/moderate', async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = parseUserId(req.params.instanceId);
  const action = String(req.body?.action || '').trim();
  if (!instanceId || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const rows = await db.query(
      `SELECT i.id, i.customization_json, c.slug, c.asset_json
       FROM user_item_instances i
       JOIN marketplace_items c ON c.id = i.item_id
       WHERE i.id = ? AND c.item_type = 'badge'
       LIMIT 1`,
      [instanceId]
    );
    const row = rows[0];
    if (!row || !canCustomizeBadgeLabel(row)) {
      return res.status(404).json({ error: 'Бейдж не найден' });
    }

    const customization = parseCustomization(row.customization_json);
    if (customization.customLabelStatus !== 'pending' || !customization.customLabel) {
      return res.status(400).json({ error: 'Нет заявки на модерацию' });
    }

    const next = {
      ...customization,
      customLabelStatus: action === 'approve' ? 'approved' : 'rejected',
      customLabelModeratedAt: Date.now(),
      customLabelModeratedBy: req.user.id,
    };

    await db.query('UPDATE user_item_instances SET customization_json = ? WHERE id = ?', [
      JSON.stringify(next),
      instanceId,
    ]);

    res.json({ ok: true, status: next.customLabelStatus });
  } catch {
    res.status(500).json({ error: 'Не удалось обработать заявку' });
  }
});

module.exports = { router, isAdminUser, adminMiddleware };
