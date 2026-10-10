const express = require('express');
const db = require('./db');
const { authMiddleware, publicUser } = require('./auth');
const { formatCatalogItem, formatInstance, loadEquippedCosmetics, buildCosmeticCustomizationPatch, parseAsset, parseCustomization, isGrantOnlyItem, canCustomizeBadgeLabel } = require('./cosmetics');

const router = express.Router();
const VALID_TYPES = new Set(['frame', 'name_color', 'badge']);
const SLOT_COLUMNS = {
  frame: 'equipped_frame_instance_id',
  name_color: 'equipped_name_color_instance_id',
  badge: 'equipped_badge_instance_id',
  badge2: 'equipped_badge_2_instance_id',
};
const BADGE_SLOTS = ['badge', 'badge2'];

function ensureDbReady(res) {
  if (!db.isReady()) {
    res.status(503).json({ error: 'База данных недоступна' });
    return false;
  }
  return true;
}

async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function queryConn(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function getUserCoins(conn, userId, lock = false) {
  const sql = `SELECT render_coins FROM users WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`;
  const rows = await queryConn(conn, sql, [userId]);
  return Number(rows[0]?.render_coins) || 0;
}

async function adjustCoins(conn, userId, delta) {
  const current = await getUserCoins(conn, userId, true);
  const next = current + delta;
  if (next < 0) {
    const err = new Error('INSUFFICIENT_COINS');
    err.code = 'INSUFFICIENT_COINS';
    throw err;
  }
  await queryConn(conn, 'UPDATE users SET render_coins = ? WHERE id = ?', [next, userId]);
  return next;
}

async function getInstanceForUser(conn, instanceId, userId, lock = false) {
  const rows = await queryConn(
    conn,
    `SELECT
      i.id AS instance_id,
      i.user_id,
      i.item_id,
      i.acquired_at,
      i.source,
      i.listed_at,
      i.listing_price,
      i.customization_json,
      c.id, c.slug, c.name, c.item_type, c.asset_json, c.price_coins, c.is_tradable, c.sort_order
    FROM user_item_instances i
    JOIN marketplace_items c ON c.id = i.item_id
    WHERE i.id = ? AND i.user_id = ?
    LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [instanceId, userId]
  );
  return rows[0] || null;
}

async function clearEquippedIfMatches(conn, userId, instanceId) {
  await queryConn(
    conn,
    `UPDATE users SET
      equipped_frame_instance_id = IF(equipped_frame_instance_id = ?, NULL, equipped_frame_instance_id),
      equipped_name_color_instance_id = IF(equipped_name_color_instance_id = ?, NULL, equipped_name_color_instance_id),
      equipped_badge_instance_id = IF(equipped_badge_instance_id = ?, NULL, equipped_badge_instance_id),
      equipped_badge_2_instance_id = IF(equipped_badge_2_instance_id = ?, NULL, equipped_badge_2_instance_id)
    WHERE id = ?`,
    [instanceId, instanceId, instanceId, instanceId, userId]
  );
}

async function resolveBadgeSlotColumn(conn, userId, instanceId, requestedSlot) {
  const rows = await queryConn(
    conn,
    'SELECT equipped_badge_instance_id, equipped_badge_2_instance_id FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
    [userId]
  );
  const row = rows[0] || {};
  const slot1 = row.equipped_badge_instance_id || null;
  const slot2 = row.equipped_badge_2_instance_id || null;

  if (requestedSlot === 'badge2') return 'equipped_badge_2_instance_id';
  if (requestedSlot === 'badge') return 'equipped_badge_instance_id';

  if (Number(slot1) === Number(instanceId)) return 'equipped_badge_instance_id';
  if (Number(slot2) === Number(instanceId)) return 'equipped_badge_2_instance_id';
  if (!slot1) return 'equipped_badge_instance_id';
  if (!slot2) return 'equipped_badge_2_instance_id';
  return 'equipped_badge_instance_id';
}

router.get('/catalog', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const type = String(req.query.type || '').trim();
  const shopOnly = String(req.query.shop || '') === '1';
  try {
    const params = [];
    let sql = 'SELECT * FROM marketplace_items WHERE 1=1';
    if (type && VALID_TYPES.has(type)) {
      sql += ' AND item_type = ?';
      params.push(type);
    }
    sql += ' ORDER BY sort_order ASC, id ASC';
    const rows = await db.query(sql, params);
    const items = rows.map(formatCatalogItem);
    res.json(shopOnly ? items.filter((item) => !item.grantOnly) : items);
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить каталог' });
  }
});

router.get('/inventory', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  try {
    const [rows, equipped, userRows] = await Promise.all([
      db.query(
        `SELECT
          i.id AS instance_id,
          i.item_id,
          i.acquired_at,
          i.source,
          i.listed_at,
          i.listing_price,
          i.customization_json,
          c.id, c.slug, c.name, c.item_type, c.asset_json, c.price_coins, c.is_tradable, c.sort_order
        FROM user_item_instances i
        JOIN marketplace_items c ON c.id = i.item_id
        WHERE i.user_id = ?
        ORDER BY i.acquired_at DESC`,
        [req.user.id]
      ),
      loadEquippedCosmetics(req.user.id),
      db.query(
        'SELECT render_coins, equipped_frame_instance_id, equipped_name_color_instance_id, equipped_badge_instance_id, equipped_badge_2_instance_id FROM users WHERE id = ? LIMIT 1',
        [req.user.id]
      ),
    ]);

    const userRow = userRows[0] || {};
    res.json({
      renderCoins: Number(userRow.render_coins) || 0,
      equippedInstanceIds: {
        frame: userRow.equipped_frame_instance_id || null,
        nameColor: userRow.equipped_name_color_instance_id || null,
        badge: userRow.equipped_badge_instance_id || null,
        badge2: userRow.equipped_badge_2_instance_id || null,
      },
      equipped,
      items: rows.map(formatInstance),
    });
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить инвентарь' });
  }
});

router.get('/listings', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const type = String(req.query.type || '').trim();
  const mine = String(req.query.mine || '') === '1';

  try {
    const params = [];
    let sql = `
      SELECT
        i.id AS instance_id,
        i.item_id,
        i.acquired_at,
        i.source,
        i.listed_at,
        i.listing_price,
        c.id, c.slug, c.name, c.item_type, c.asset_json, c.price_coins, c.is_tradable, c.sort_order,
        u.id AS seller_id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.bio,
        u.static_id,
        u.created_at AS user_created_at
      FROM user_item_instances i
      JOIN marketplace_items c ON c.id = i.item_id
      JOIN users u ON u.id = i.user_id
      WHERE i.listing_price IS NOT NULL AND i.listed_at IS NOT NULL
    `;

    if (mine) {
      sql += ' AND i.user_id = ?';
      params.push(req.user.id);
    } else {
      sql += ' AND i.user_id <> ?';
      params.push(req.user.id);
    }

    if (type && VALID_TYPES.has(type)) {
      sql += ' AND c.item_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY i.listed_at DESC LIMIT 100';
    const rows = await db.query(sql, params);

    res.json(
      rows.map((row) => ({
        ...formatInstance(row),
        seller: publicUser({
          id: row.seller_id,
          username: row.username,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          bio: row.bio,
          static_id: row.static_id,
          created_at: row.user_created_at,
        }),
      }))
    );
  } catch {
    res.status(500).json({ error: 'Не удалось загрузить лоты' });
  }
});

router.post('/buy', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const itemId = Number(req.body?.itemId);
  if (!itemId) {
    return res.status(400).json({ error: 'Неверный товар' });
  }

  try {
    const result = await withTransaction(async (conn) => {
      const catalogRows = await queryConn(
        conn,
        'SELECT * FROM marketplace_items WHERE id = ? LIMIT 1 FOR UPDATE',
        [itemId]
      );
      const catalogItem = catalogRows[0];
      if (!catalogItem) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (isGrantOnlyItem(catalogItem)) {
        const err = new Error('NOT_FOR_SALE');
        err.code = 'NOT_FOR_SALE';
        throw err;
      }

      const price = Number(catalogItem.price_coins) || 0;
      await adjustCoins(conn, req.user.id, -price);

      const insert = await queryConn(
        conn,
        'INSERT INTO user_item_instances (user_id, item_id, source) VALUES (?, ?, ?)',
        [req.user.id, itemId, 'purchase']
      );

      const balance = await getUserCoins(conn, req.user.id);
      return {
        instanceId: insert.insertId,
        balance,
        item: formatCatalogItem(catalogItem),
      };
    });

    res.status(201).json(result);
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    if (error.code === 'NOT_FOR_SALE') {
      return res.status(400).json({ error: 'Этот предмет нельзя купить' });
    }
    if (error.code === 'INSUFFICIENT_COINS') {
      return res.status(400).json({ error: 'Недостаточно RenderCoin' });
    }
    res.status(500).json({ error: 'Не удалось купить' });
  }
});

async function saveCosmeticCustomization(conn, instanceId, assetJson, body, currentCustomization = {}, slug = '') {
  const asset = parseAsset(assetJson);
  const patch = buildCosmeticCustomizationPatch(asset, body, currentCustomization, slug);
  if (!Object.keys(patch).length) return null;
  await queryConn(conn, 'UPDATE user_item_instances SET customization_json = ? WHERE id = ?', [
    JSON.stringify(patch),
    instanceId,
  ]);
  return patch;
}

const saveFrameCustomization = saveCosmeticCustomization;

router.post('/equip', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = Number(req.body?.instanceId);
  const frameColor = req.body?.frameColor;
  const neonGradient = req.body?.neonGradient;
  const nameGradient = req.body?.nameGradient;
  if (!instanceId) {
    return res.status(400).json({ error: 'Неверный предмет' });
  }

  try {
    const equipped = await withTransaction(async (conn) => {
      const row = await getInstanceForUser(conn, instanceId, req.user.id, true);
      if (!row) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (row.listed_at) {
        const err = new Error('LISTED');
        err.code = 'LISTED';
        throw err;
      }

      const column = row.item_type === 'badge'
        ? await resolveBadgeSlotColumn(conn, req.user.id, instanceId, String(req.body?.slot || '').trim())
        : SLOT_COLUMNS[row.item_type];
      if (!column) {
        const err = new Error('BAD_TYPE');
        err.code = 'BAD_TYPE';
        throw err;
      }

      if (row.item_type === 'badge') {
        await queryConn(
          conn,
          `UPDATE users SET
            equipped_badge_instance_id = IF(equipped_badge_instance_id = ?, NULL, equipped_badge_instance_id),
            equipped_badge_2_instance_id = IF(equipped_badge_2_instance_id = ?, NULL, equipped_badge_2_instance_id)
          WHERE id = ?`,
          [instanceId, instanceId, req.user.id]
        );
      }

      if ((frameColor != null || neonGradient != null || nameGradient != null)) {
        await saveCosmeticCustomization(
          conn,
          instanceId,
          row.asset_json,
          { frameColor, neonGradient, nameGradient },
          parseCustomization(row.customization_json),
          row.slug
        );
      }

      await queryConn(conn, `UPDATE users SET ${column} = ? WHERE id = ?`, [instanceId, req.user.id]);
      return loadEquippedCosmetics(req.user.id);
    });

    res.json({ ok: true, equipped });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Предмет не найден' });
    }
    if (error.code === 'LISTED') {
      return res.status(400).json({ error: 'Снимите предмет с продажи перед экипировкой' });
    }
    res.status(500).json({ error: 'Не удалось экипировать' });
  }
});

router.post('/customize/:instanceId', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = Number(req.params.instanceId);
  const frameColor = req.body?.frameColor;
  const neonGradient = req.body?.neonGradient;
  const nameGradient = req.body?.nameGradient;
  const customLabel = req.body?.customLabel;
  if (!instanceId || (frameColor == null && neonGradient == null && nameGradient == null && customLabel == null)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }

  try {
    await withTransaction(async (conn) => {
      const row = await getInstanceForUser(conn, instanceId, req.user.id, true);
      if (!row) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (customLabel != null) {
        if (row.item_type !== 'badge' || !canCustomizeBadgeLabel(row)) {
          const err = new Error('BAD_TYPE');
          err.code = 'BAD_TYPE';
          throw err;
        }
        const asset = parseAsset(row.asset_json);
        const patch = buildCosmeticCustomizationPatch(
          asset,
          { customLabel },
          parseCustomization(row.customization_json),
          row.slug
        );
        if (!patch) {
          const err = new Error('BAD_LABEL');
          err.code = 'BAD_LABEL';
          throw err;
        }
        await queryConn(conn, 'UPDATE user_item_instances SET customization_json = ? WHERE id = ?', [
          JSON.stringify(patch),
          instanceId,
        ]);
        return;
      }
      if (row.item_type !== 'frame' && row.item_type !== 'name_color') {
        const err = new Error('BAD_TYPE');
        err.code = 'BAD_TYPE';
        throw err;
      }
      await saveCosmeticCustomization(
        conn,
        instanceId,
        row.asset_json,
        { frameColor, neonGradient, nameGradient },
        parseCustomization(row.customization_json),
        row.slug
      );
    });

    const equipped = await loadEquippedCosmetics(req.user.id);
    res.json({ ok: true, equipped });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Предмет не найден' });
    }
    if (error.code === 'BAD_TYPE') {
      return res.status(400).json({ error: customLabel != null ? 'Только для кастомных бейджей' : 'Цвет доступен только для рамок' });
    }
    if (error.code === 'BAD_LABEL') {
      return res.status(400).json({ error: 'Укажите название бейджа (1–32 символа)' });
    }
    res.status(500).json({ error: 'Не удалось сохранить цвет' });
  }
});

router.post('/unequip', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const slot = String(req.body?.slot || '').trim();
  const column = SLOT_COLUMNS[slot];
  if (!column) {
    return res.status(400).json({ error: 'Неверный слот' });
  }

  try {
    await db.query(`UPDATE users SET ${column} = NULL WHERE id = ?`, [req.user.id]);
    const equipped = await loadEquippedCosmetics(req.user.id);
    res.json({ ok: true, equipped });
  } catch {
    res.status(500).json({ error: 'Не удалось снять предмет' });
  }
});

router.post('/list', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = Number(req.body?.instanceId);
  const priceCoins = Number(req.body?.priceCoins);
  if (!instanceId || !Number.isFinite(priceCoins) || priceCoins < 10) {
    return res.status(400).json({ error: 'Укажите цену от 10 RenderCoin' });
  }

  try {
    await withTransaction(async (conn) => {
      const row = await getInstanceForUser(conn, instanceId, req.user.id, true);
      if (!row) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (!row.is_tradable || isGrantOnlyItem(row)) {
        const err = new Error('NOT_TRADABLE');
        err.code = 'NOT_TRADABLE';
        throw err;
      }
      if (row.listed_at) {
        const err = new Error('ALREADY_LISTED');
        err.code = 'ALREADY_LISTED';
        throw err;
      }

      await clearEquippedIfMatches(conn, req.user.id, instanceId);
      await queryConn(
        conn,
        'UPDATE user_item_instances SET listing_price = ?, listed_at = NOW() WHERE id = ?',
        [Math.min(Math.floor(priceCoins), 999999), instanceId]
      );
    });

    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Предмет не найден' });
    }
    if (error.code === 'NOT_TRADABLE') {
      return res.status(400).json({ error: 'Этот предмет нельзя продать' });
    }
    if (error.code === 'ALREADY_LISTED') {
      return res.status(400).json({ error: 'Предмет уже выставлен' });
    }
    res.status(500).json({ error: 'Не удалось выставить на продажу' });
  }
});

router.delete('/list/:instanceId', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = Number(req.params.instanceId);
  if (!instanceId) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  try {
    const result = await db.query(
      `UPDATE user_item_instances
       SET listing_price = NULL, listed_at = NULL
       WHERE id = ? AND user_id = ? AND listed_at IS NOT NULL`,
      [instanceId, req.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Лот не найден' });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Не удалось снять с продажи' });
  }
});

router.post('/buy-listing/:instanceId', authMiddleware, async (req, res) => {
  if (!ensureDbReady(res)) return;

  const instanceId = Number(req.params.instanceId);
  if (!instanceId) {
    return res.status(400).json({ error: 'Неверный лот' });
  }

  try {
    const result = await withTransaction(async (conn) => {
      const rows = await queryConn(
        conn,
        `SELECT
          i.id AS instance_id,
          i.user_id,
          i.item_id,
          i.listing_price,
          i.listed_at,
          c.item_type
        FROM user_item_instances i
        JOIN marketplace_items c ON c.id = i.item_id
        WHERE i.id = ? AND i.listing_price IS NOT NULL AND i.listed_at IS NOT NULL
        LIMIT 1 FOR UPDATE`,
        [instanceId]
      );
      const listing = rows[0];
      if (!listing) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (Number(listing.user_id) === Number(req.user.id)) {
        const err = new Error('SELF');
        err.code = 'SELF';
        throw err;
      }

      const price = Number(listing.listing_price) || 0;
      await adjustCoins(conn, req.user.id, -price);
      await adjustCoins(conn, listing.user_id, price);
      await clearEquippedIfMatches(conn, listing.user_id, instanceId);
      await queryConn(
        conn,
        `UPDATE user_item_instances
         SET user_id = ?, source = 'resale', listing_price = NULL, listed_at = NULL
         WHERE id = ?`,
        [req.user.id, instanceId]
      );

      const balance = await getUserCoins(conn, req.user.id);
      return { balance, instanceId };
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Лот не найден' });
    }
    if (error.code === 'SELF') {
      return res.status(400).json({ error: 'Нельзя купить свой лот' });
    }
    if (error.code === 'INSUFFICIENT_COINS') {
      return res.status(400).json({ error: 'Недостаточно RenderCoin' });
    }
    res.status(500).json({ error: 'Не удалось купить лот' });
  }
});

module.exports = { router, loadEquippedCosmetics };
