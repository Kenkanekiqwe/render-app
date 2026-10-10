const db = require('./db');

function parseAsset(raw) {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function parseCustomization(raw) {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function isGrantOnlyItem(row) {
  if (!row) return false;
  const slug = String(row.slug || '');
  if (slug.endsWith('-custom')) return true;
  const asset = row.asset || parseAsset(row.asset_json);
  return Boolean(asset.grantOnly);
}

const BADGE_LABEL_EXCLUDED_SLUGS = new Set([
  'badge-early-custom',
  'badge-support-custom',
]);

function isCustomBadgeItem(row) {
  if (!row) return false;
  const slug = String(row.slug || '');
  if (slug.endsWith('-custom')) return true;
  const asset = row.asset || parseAsset(row.asset_json);
  if (asset.customizableLabel) return true;
  const badgeClass = String(asset.badgeClass || '');
  return badgeClass.startsWith('badge-custom');
}

function canCustomizeBadgeLabel(row) {
  if (!row) return false;
  const slug = String(row.slug || row.item?.slug || '');
  if (BADGE_LABEL_EXCLUDED_SLUGS.has(slug)) return false;
  const asset = row.asset || parseAsset(row.asset_json);
  if (asset?.customizableLabel) return true;
  if (slug.endsWith('-custom')) return true;
  const badgeClass = String(asset?.badgeClass || '');
  return badgeClass.startsWith('badge-custom');
}

function getBadgeDisplayLabel(item, customization = {}) {
  if (!item) return '';
  const asset = item.asset || parseAsset(item.asset_json) || {};
  const custom = customization || item.customization || {};
  if (canCustomizeBadgeLabel(item) && custom.customLabelStatus === 'approved' && custom.customLabel) {
    return String(custom.customLabel).trim().slice(0, 32);
  }
  return String(asset.label || item.name || '').trim();
}

function buildBadgeLabelPatch(body = {}, current = {}) {
  const label = String(body.customLabel || '').trim().slice(0, 32);
  if (!label) return null;
  return {
    ...current,
    customLabel: label,
    customLabelStatus: 'pending',
    customLabelSubmittedAt: Date.now(),
    customLabelModeratedAt: null,
    customLabelModeratedBy: null,
  };
}

function normalizeFrameColor(value, fallback = '#e8eaef') {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

const DEFAULT_NEON_GRADIENT = {
  colors: ['#7c5cff', '#00d4ff', '#ff6bcb'],
  stops: [33, 66],
  speed: 4,
};

const DEFAULT_NAME_GRADIENTS = {
  'color-rainbow': { colors: ['#ff6bcb', '#9b7bff', '#4ecbff'], stops: [33, 66], speed: 3 },
};

function normalizeAnimationSpeed(value, fallback = 4) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return fallback;
  return Math.min(12, Math.max(1, Math.round(speed * 10) / 10));
}

function normalizeGradient(raw, fallback = DEFAULT_NEON_GRADIENT) {
  const base = fallback || DEFAULT_NEON_GRADIENT;
  const source = raw && typeof raw === 'object' ? raw : {};
  const colors = (Array.isArray(source.colors) ? source.colors : base.colors)
    .slice(0, 3)
    .map((color, index) => normalizeFrameColor(color, base.colors[index] || base.colors[0]));
  while (colors.length < 3) {
    colors.push(base.colors[colors.length] || base.colors[0]);
  }

  const stopsRaw = Array.isArray(source.stops) ? source.stops : base.stops;
  let stop1 = Math.round(Number(stopsRaw[0]));
  let stop2 = Math.round(Number(stopsRaw[1]));
  if (!Number.isFinite(stop1)) stop1 = base.stops[0];
  if (!Number.isFinite(stop2)) stop2 = base.stops[1];
  stop1 = Math.min(80, Math.max(10, stop1));
  stop2 = Math.min(95, Math.max(stop1 + 5, stop2));

  return {
    colors,
    stops: [stop1, stop2],
    speed: normalizeAnimationSpeed(source.speed, base.speed ?? 4),
  };
}

const normalizeNeonGradient = normalizeGradient;

function getDefaultNameGradient(asset, slug = '') {
  return asset?.defaultNameGradient || DEFAULT_NAME_GRADIENTS[slug] || DEFAULT_NAME_GRADIENTS['color-rainbow'];
}

function isNeonFrameAsset(asset, slug = '') {
  return asset?.frameClass === 'frame-neon'
    || Boolean(asset?.customizableGradient && asset?.frameClass)
    || slug === 'frame-neon';
}

function isNameColorAsset(asset, slug = '') {
  return slug === 'color-rainbow' || asset?.colorClass === 'name-rainbow';
}

function buildCosmeticCustomizationPatch(asset, body = {}, current = {}, slug = '') {
  const patch = { ...current };
  if (body.customLabel != null && canCustomizeBadgeLabel({ slug, asset })) {
    const labelPatch = buildBadgeLabelPatch(body, current);
    if (labelPatch) return labelPatch;
  }
  if (body.frameColor != null && asset?.customizable) {
    patch.frameColor = normalizeFrameColor(body.frameColor, asset.defaultColor || '#e8eaef');
  }
  if (body.neonGradient != null && isNeonFrameAsset(asset, slug)) {
    patch.neonGradient = normalizeGradient(
      body.neonGradient,
      asset.defaultNeonGradient || DEFAULT_NEON_GRADIENT
    );
  }
  if (body.nameGradient != null && isNameColorAsset(asset, slug)) {
    patch.nameGradient = normalizeGradient(body.nameGradient, getDefaultNameGradient(asset, slug));
  }
  return patch;
}

const buildFrameCustomizationPatch = buildCosmeticCustomizationPatch;

function formatCatalogItem(row, customization = null) {
  if (!row) return null;
  const asset = parseAsset(row.asset_json);
  const item = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    itemType: row.item_type,
    priceCoins: row.price_coins,
    isTradable: Boolean(row.is_tradable),
    grantOnly: isGrantOnlyItem(row),
    sortOrder: row.sort_order || 0,
    asset,
  };
  const custom = customization || {};
  if (Object.keys(custom).length) {
    item.customization = custom;
  }
  return item;
}

function formatInstance(row) {
  if (!row) return null;
  const customization = parseCustomization(row.customization_json);
  const instance = {
    id: row.instance_id,
    itemId: row.item_id,
    acquiredAt: row.acquired_at ? new Date(row.acquired_at).getTime() : null,
    source: row.source,
    listedAt: row.listed_at ? new Date(row.listed_at).getTime() : null,
    listingPrice: row.listing_price != null ? Number(row.listing_price) : null,
    customization,
    item: formatCatalogItem(row, customization),
  };
  if (instance.item?.itemType === 'badge') {
    instance.item.displayLabel = getBadgeDisplayLabel(instance.item, customization);
  }
  return instance;
}

function formatEquippedItem(row, prefix) {
  const itemId = row[`${prefix}_item_id`];
  if (!itemId) return null;

  const customization = parseCustomization(row[`${prefix}_customization_json`]);
  const item = formatCatalogItem(
    {
      id: itemId,
      slug: row[`${prefix}_slug`],
      name: row[`${prefix}_name`],
      item_type: row[`${prefix}_item_type`],
      asset_json: row[`${prefix}_asset_json`],
      price_coins: row[`${prefix}_price_coins`],
      is_tradable: row[`${prefix}_is_tradable`],
      sort_order: row[`${prefix}_sort_order`],
    },
    customization
  );
  if (item && item.itemType === 'badge') {
    item.displayLabel = getBadgeDisplayLabel(item, customization);
  }
  return item;
}

function equippedFromSlots(frame, nameColor, badge, badge2 = null) {
  return { frame, nameColor, badge, badge2 };
}

async function loadEquippedCosmetics(userId) {
  const rows = await db.query(
    `SELECT
      fi.customization_json AS frame_customization_json,
      fc.id AS frame_item_id, fc.slug AS frame_slug, fc.name AS frame_name,
      fc.item_type AS frame_item_type, fc.asset_json AS frame_asset_json,
      fc.price_coins AS frame_price_coins, fc.is_tradable AS frame_is_tradable,
      fc.sort_order AS frame_sort_order,
      ni.customization_json AS color_customization_json,
      nc.id AS color_item_id, nc.slug AS color_slug, nc.name AS color_name,
      nc.item_type AS color_item_type, nc.asset_json AS color_asset_json,
      nc.price_coins AS color_price_coins, nc.is_tradable AS color_is_tradable,
      nc.sort_order AS color_sort_order,
      bi.customization_json AS badge_customization_json,
      bc.id AS badge_item_id, bc.slug AS badge_slug, bc.name AS badge_name,
      bc.item_type AS badge_item_type, bc.asset_json AS badge_asset_json,
      bc.price_coins AS badge_price_coins, bc.is_tradable AS badge_is_tradable,
      bc.sort_order AS badge_sort_order,
      bi2.customization_json AS badge2_customization_json,
      bc2.id AS badge2_item_id, bc2.slug AS badge2_slug, bc2.name AS badge2_name,
      bc2.item_type AS badge2_item_type, bc2.asset_json AS badge2_asset_json,
      bc2.price_coins AS badge2_price_coins, bc2.is_tradable AS badge2_is_tradable,
      bc2.sort_order AS badge2_sort_order
    FROM users u
    LEFT JOIN user_item_instances fi ON fi.id = u.equipped_frame_instance_id
    LEFT JOIN marketplace_items fc ON fc.id = fi.item_id
    LEFT JOIN user_item_instances ni ON ni.id = u.equipped_name_color_instance_id
    LEFT JOIN marketplace_items nc ON nc.id = ni.item_id
    LEFT JOIN user_item_instances bi ON bi.id = u.equipped_badge_instance_id
    LEFT JOIN marketplace_items bc ON bc.id = bi.item_id
    LEFT JOIN user_item_instances bi2 ON bi2.id = u.equipped_badge_2_instance_id
    LEFT JOIN marketplace_items bc2 ON bc2.id = bi2.item_id
    WHERE u.id = ?
    LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  if (!row) {
    return { frame: null, nameColor: null, badge: null, badge2: null };
  }

  return equippedFromSlots(
    formatEquippedItem(row, 'frame'),
    formatEquippedItem(row, 'color'),
    formatEquippedItem(row, 'badge'),
    formatEquippedItem(row, 'badge2')
  );
}

module.exports = {
  parseAsset,
  parseCustomization,
  isGrantOnlyItem,
  isCustomBadgeItem,
  canCustomizeBadgeLabel,
  getBadgeDisplayLabel,
  buildBadgeLabelPatch,
  normalizeFrameColor,
  normalizeNeonGradient,
  buildCosmeticCustomizationPatch,
  buildFrameCustomizationPatch,
  formatCatalogItem,
  formatInstance,
  loadEquippedCosmetics,
  equippedFromSlots,
};
