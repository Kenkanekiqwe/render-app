const mysql = require('mysql2/promise');
const { seedMarketplaceCatalog } = require('./marketplace-seed');
const { migrateEarlyUserBadges } = require('./badges');

let pool = null;
let initPromise = null;
let dbReady = false;

// Shared database that BOTH the website and the desktop app connect to.
// Keep these defaults in sync so accounts/data never differ between them.
// Any value can still be overridden via .env (DATABASE_URL or DB_* vars).
const DEFAULTS = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'render_music',
};

/**
 * Parse a single connection string (mysql://user:pass@host:port/db) when the
 * DATABASE_URL / MYSQL_URL env var is provided. Returns null when absent.
 */
function parseConnectionUrl() {
  const raw = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return {
      host: decodeURIComponent(url.hostname) || DEFAULTS.host,
      port: Number(url.port || DEFAULTS.port),
      user: decodeURIComponent(url.username) || DEFAULTS.user,
      password: decodeURIComponent(url.password) || '',
      database: url.pathname.replace(/^\//, '') || DEFAULTS.database,
    };
  } catch {
    return null;
  }
}

function getConfig() {
  const fromUrl = parseConnectionUrl();

  const base = fromUrl || {
    host: process.env.DB_HOST || DEFAULTS.host,
    port: Number(process.env.DB_PORT || DEFAULTS.port),
    user: process.env.DB_USER || DEFAULTS.user,
    password: process.env.DB_PASSWORD || DEFAULTS.password,
    database: process.env.DB_NAME || DEFAULTS.database,
  };

  return {
    ...base,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  };
}

const USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(32) NOT NULL,
    username_lower VARCHAR(32) NOT NULL,
    email VARCHAR(190) NULL,
    email_lower VARCHAR(190) NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    avatar_url TEXT NULL,
    bio VARCHAR(500) NULL,
    static_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_username_lower (username_lower),
    UNIQUE KEY uniq_email_lower (email_lower)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FRIENDSHIPS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS friendships (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    requester_id BIGINT UNSIGNED NOT NULL,
    addressee_id BIGINT UNSIGNED NOT NULL,
    status ENUM('pending', 'accepted') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_friendship (requester_id, addressee_id),
    KEY idx_requester (requester_id),
    KEY idx_addressee (addressee_id),
    CONSTRAINT fk_friend_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friend_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CHAT_MESSAGES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    message VARCHAR(2000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_chat_created (created_at),
    CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const TRACK_COMMENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS track_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    track_id VARCHAR(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    message VARCHAR(400) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_track_comments_track (track_id, id),
    KEY idx_track_comments_user (user_id),
    CONSTRAINT fk_track_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const DIRECT_MESSAGES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS direct_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sender_id BIGINT UNSIGNED NOT NULL,
    recipient_id BIGINT UNSIGNED NOT NULL,
    message VARCHAR(2000) NOT NULL,
    message_type VARCHAR(16) NOT NULL DEFAULT 'text',
    media_url TEXT NULL,
    sticker_id BIGINT UNSIGNED NULL,
    pack_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dm_pair (sender_id, recipient_id, id),
    KEY idx_dm_recipient (recipient_id, id),
    CONSTRAINT fk_dm_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_dm_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const WORKSHOP_ITEMS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS workshop_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    item_type ENUM('background', 'banner', 'avatar') NOT NULL DEFAULT 'background',
    url TEXT NOT NULL,
    description VARCHAR(500) NULL,
    uses_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_workshop_type (item_type),
    KEY idx_workshop_created (created_at),
    CONSTRAINT fk_workshop_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USER_ACCOUNT_STATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_account_state (
    user_id BIGINT UNSIGNED NOT NULL,
    state_json LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_account_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USER_PLAYLISTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_playlists (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    local_id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    cover_url TEXT NULL,
    tracks_json LONGTEXT NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'user',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_user_playlist (user_id, local_id),
    KEY idx_user_playlists_user (user_id),
    CONSTRAINT fk_user_playlists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USER_PROFILE_COLUMNS = [
  'ADD COLUMN banner_url TEXT NULL',
  'ADD COLUMN banner_position_y TINYINT UNSIGNED NOT NULL DEFAULT 50',
  'ADD COLUMN banner_height SMALLINT UNSIGNED NOT NULL DEFAULT 200',
  'ADD COLUMN banner_overlay TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'ADD COLUMN background_url TEXT NULL',
  'ADD COLUMN privacy_hidden_account TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN privacy_hide_created_at TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN privacy_hide_playlists TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN privacy_hide_avatar TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN privacy_hide_banner TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN pinned_track_json TEXT NULL',
  'ADD COLUMN now_playing_json TEXT NULL',
  'ADD COLUMN profile_links_json TEXT NULL',
  'ADD COLUMN privacy_hide_now_playing TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN render_coins INT UNSIGNED NOT NULL DEFAULT 1000',
  'ADD COLUMN equipped_frame_instance_id BIGINT UNSIGNED NULL',
  'ADD COLUMN equipped_name_color_instance_id BIGINT UNSIGNED NULL',
  'ADD COLUMN equipped_badge_instance_id BIGINT UNSIGNED NULL',
  'ADD COLUMN equipped_badge_2_instance_id BIGINT UNSIGNED NULL',
  'ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0',
  'ADD COLUMN banned_at DATETIME NULL',
  'ADD COLUMN ban_reason VARCHAR(500) NULL',
];

const MARKETPLACE_ITEMS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS marketplace_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    item_type ENUM('frame', 'name_color', 'badge') NOT NULL,
    asset_json TEXT NOT NULL,
    price_coins INT UNSIGNED NOT NULL DEFAULT 0,
    is_tradable TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_marketplace_slug (slug),
    KEY idx_marketplace_type (item_type),
    KEY idx_marketplace_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USER_ITEM_INSTANCES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_item_instances (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    source ENUM('purchase', 'resale', 'grant') NOT NULL DEFAULT 'purchase',
    listing_price INT UNSIGNED NULL,
    listed_at DATETIME NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_instances_user (user_id),
    KEY idx_instances_item (item_id),
    KEY idx_instances_listed (listed_at),
    CONSTRAINT fk_instances_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_instances_item FOREIGN KEY (item_id) REFERENCES marketplace_items(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const INSTANCE_EXTRA_COLUMNS = [
  'ADD COLUMN customization_json TEXT NULL',
];

const CHAT_MESSAGE_COLUMNS = [
  'ADD COLUMN message_type VARCHAR(16) NOT NULL DEFAULT \'text\'',
  'ADD COLUMN media_url TEXT NULL',
  'ADD COLUMN sticker_id BIGINT UNSIGNED NULL',
  'ADD COLUMN pack_id BIGINT UNSIGNED NULL',
];

const STICKER_PACKS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sticker_packs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(64) NOT NULL,
    cover_url TEXT NULL,
    is_public TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_sticker_packs_user (user_id),
    CONSTRAINT fk_sticker_packs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const STICKERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS stickers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pack_id BIGINT UNSIGNED NOT NULL,
    image_url TEXT NOT NULL,
    label VARCHAR(32) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_stickers_pack (pack_id),
    CONSTRAINT fk_stickers_pack FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USER_STICKER_PACKS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_sticker_packs (
    user_id BIGINT UNSIGNED NOT NULL,
    pack_id BIGINT UNSIGNED NOT NULL,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pack_id),
    KEY idx_user_sticker_packs_pack (pack_id),
    CONSTRAINT fk_user_sticker_packs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_sticker_packs_pack FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function tableColumnSet(pool, database, table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  );
  return new Set(rows.map((row) => row.name));
}

function alterColumnName(clause) {
  const match = String(clause).match(/ADD COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
  return match ? match[1] : null;
}

async function ensureColumns(pool, database, table, clauses) {
  const existing = await tableColumnSet(pool, database, table);
  if (!existing.size) return;

  for (const clause of clauses) {
    const name = alterColumnName(clause);
    if (name && existing.has(name)) continue;
    try {
      await pool.query(`ALTER TABLE \`${table}\` ${clause}`);
      if (name) existing.add(name);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

async function ensureChatMessageColumns(pool, database) {
  await ensureColumns(pool, database, 'chat_messages', CHAT_MESSAGE_COLUMNS);
}

async function ensureInstanceColumns(pool, database) {
  await ensureColumns(pool, database, 'user_item_instances', INSTANCE_EXTRA_COLUMNS);
}

async function seedDefaultAdmins(pool) {
  await pool.query('UPDATE users SET is_admin = 1 WHERE id IN (1, 2)');
}

async function ensureUserProfileColumns(pool, database) {
  await ensureColumns(pool, database, 'users', USER_PROFILE_COLUMNS);
}

async function ensureDatabase(config) {
  const pool = mysql.createPool(config);
  try {
    await pool.query('SELECT 1');
    return pool;
  } catch (error) {
    await pool.end().catch(() => {});
    if (error.code !== 'ER_BAD_DB_ERROR') throw error;
  }

  const bootstrap = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: config.charset,
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await bootstrap.end();
  return mysql.createPool(config);
}

/**
 * Lazily create the pool and ensure the schema exists.
 * The database itself is created if it does not exist yet.
 */
async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const config = getConfig();
    pool = await ensureDatabase(config);
    await pool.query(USERS_TABLE_SQL);
    await ensureUserProfileColumns(pool, config.database);
    await pool.query(FRIENDSHIPS_TABLE_SQL);
    await pool.query(CHAT_MESSAGES_TABLE_SQL);
    await ensureChatMessageColumns(pool, config.database);
    await pool.query(TRACK_COMMENTS_TABLE_SQL);
    await pool.query(DIRECT_MESSAGES_TABLE_SQL);
    await pool.query(STICKER_PACKS_TABLE_SQL);
    await pool.query(STICKERS_TABLE_SQL);
    await pool.query(USER_STICKER_PACKS_TABLE_SQL);
    await pool.query(WORKSHOP_ITEMS_TABLE_SQL);
    await pool.query(USER_PLAYLISTS_TABLE_SQL);
    await pool.query(USER_ACCOUNT_STATE_TABLE_SQL);
    await pool.query(MARKETPLACE_ITEMS_TABLE_SQL);
    await pool.query(USER_ITEM_INSTANCES_TABLE_SQL);
    await ensureInstanceColumns(pool, config.database);
    await seedMarketplaceCatalog(pool);
    await migrateEarlyUserBadges(pool);
    await seedDefaultAdmins(pool);
    dbReady = true;
    return pool;
  })().catch((error) => {
    initPromise = null;
    dbReady = false;
    throw error;
  });

  return initPromise;
}

function isReady() {
  return dbReady;
}

async function query(sql, params = []) {
  if (!pool) await init();
  const safeParams = (Array.isArray(params) ? params : [params]).map((value) =>
    value === undefined ? null : value
  );
  const [rows] = await pool.query(sql, safeParams);
  return rows;
}

async function getConnection() {
  if (!pool) await init();
  return pool.getConnection();
}

module.exports = { init, query, getConnection, isReady, getConfig };
