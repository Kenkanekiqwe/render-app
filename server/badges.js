const db = require('./db');

const EARLY_BADGE_SLUG = 'badge-early-custom';

async function queryRows(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function grantEarlyUserBadge(userId, conn = null) {
  const run = async (c) => {
    const badgeRows = await queryRows(
      c,
      'SELECT id FROM marketplace_items WHERE slug = ? LIMIT 1',
      [EARLY_BADGE_SLUG]
    );
    const itemId = badgeRows[0]?.id;
    if (!itemId) return null;

    const owned = await queryRows(
      c,
      'SELECT id FROM user_item_instances WHERE user_id = ? AND item_id = ? LIMIT 1',
      [userId, itemId]
    );
    if (owned[0]?.id) {
      return owned[0].id;
    }

    const [insertResult] = await c.execute(
      'INSERT INTO user_item_instances (user_id, item_id, source) VALUES (?, ?, ?)',
      [userId, itemId, 'grant']
    );
    const instanceId = insertResult.insertId;

    const userRows = await queryRows(
      c,
      'SELECT equipped_badge_instance_id FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!userRows[0]?.equipped_badge_instance_id) {
      await queryRows(c, 'UPDATE users SET equipped_badge_instance_id = ? WHERE id = ?', [
        instanceId,
        userId,
      ]);
    }

    return instanceId;
  };

  if (conn) {
    return run(conn);
  }

  const poolConn = await db.getConnection();
  try {
    return await run(poolConn);
  } finally {
    poolConn.release();
  }
}

async function queryPool(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function migrateEarlyUserBadges(pool) {
  const badgeRows = await queryPool(
    pool,
    'SELECT id FROM marketplace_items WHERE slug = ? LIMIT 1',
    [EARLY_BADGE_SLUG]
  );
  const itemId = badgeRows[0]?.id;
  if (!itemId) return;

  const users = await queryPool(
    pool,
    `SELECT u.id, u.equipped_badge_instance_id
     FROM users u
     WHERE NOT EXISTS (
       SELECT 1 FROM user_item_instances i
       WHERE i.user_id = u.id AND i.item_id = ?
     )`,
    [itemId]
  );

  for (const user of users) {
    const insertResult = await queryPool(
      pool,
      'INSERT INTO user_item_instances (user_id, item_id, source) VALUES (?, ?, ?)',
      [user.id, itemId, 'grant']
    );
    if (!user.equipped_badge_instance_id) {
      await queryPool(pool, 'UPDATE users SET equipped_badge_instance_id = ? WHERE id = ?', [
        insertResult.insertId,
        user.id,
      ]);
    }
  }
}

module.exports = {
  EARLY_BADGE_SLUG,
  grantEarlyUserBadge,
  migrateEarlyUserBadges,
};
