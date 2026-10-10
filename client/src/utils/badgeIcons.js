import earlyUser from '../assets/badges/early-user.png';
import staff from '../assets/badges/staff.png';
import bugHunter from '../assets/badges/bug-hunter.png';
import support from '../assets/badges/support.png';
import hammer from '../assets/badges/hammer.png';
import mana from '../assets/badges/mana.png';
import fox from '../assets/badges/fox.png';
import flowertouch from '../assets/badges/flowertouch.png';
import verified from '../assets/badges/verified.png';
import custom1 from '../assets/badges/custom-1.png';
import custom2 from '../assets/badges/custom-2.png';
import custom3 from '../assets/badges/custom-3.png';
import custom4 from '../assets/badges/custom-4.png';
import customRich from '../assets/badges/custom-rich.png';
import christmas from '../assets/badges/christmas.png';
import halloween from '../assets/badges/halloween.png';

export const BADGE_ICON_BY_CLASS = {
  'badge-early': earlyUser,
  'badge-staff': staff,
  'badge-bug-hunter': bugHunter,
  'badge-support': support,
  'badge-meloman': hammer,
  'badge-music': hammer,
  'badge-favorite': mana,
  'badge-star': mana,
  'badge-vip': verified,
  'badge-render': fox,
  'badge-flowertouch': flowertouch,
  'badge-custom-1': custom1,
  'badge-custom-2': custom2,
  'badge-custom-3': custom3,
  'badge-custom-4': custom4,
  'badge-custom-rich': customRich,
  'badge-christmas': christmas,
  'badge-halloween': halloween,
};

const BADGE_ICON_BY_FILENAME = {
  'early-user.png': earlyUser,
  'staff.png': staff,
  'bug-hunter.png': bugHunter,
  'support.png': support,
  'hammer.png': hammer,
  'mana.png': mana,
  'fox.png': fox,
  'flowertouch.png': flowertouch,
  'verified.png': verified,
  'custom-1.png': custom1,
  'custom-2.png': custom2,
  'custom-3.png': custom3,
  'custom-4.png': custom4,
  'custom-rich.png': customRich,
  'christmas.png': christmas,
  'halloween.png': halloween,
};

export function getBadgeIconUrl(badge) {
  const asset = badge?.asset || {};
  const badgeClass = asset.badgeClass || '';
  if (BADGE_ICON_BY_CLASS[badgeClass]) {
    return BADGE_ICON_BY_CLASS[badgeClass];
  }

  const iconUrl = String(asset.iconUrl || '').trim();
  if (iconUrl) {
    const filename = iconUrl.split('/').pop()?.toLowerCase() || '';
    if (BADGE_ICON_BY_FILENAME[filename]) {
      return BADGE_ICON_BY_FILENAME[filename];
    }
    if (/^https?:\/\//i.test(iconUrl)) return iconUrl;
    const base = process.env.PUBLIC_URL || '';
    return `${base}${iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`}`;
  }

  return '';
}

export function getStaffBadgeIconUrl() {
  return staff;
}

export const BADGE_LABEL_EXCLUDED_SLUGS = new Set([
  'badge-early-custom',
  'badge-support-custom',
]);

export function isCustomBadgeItem(item) {
  if (!item) return false;
  const slug = String(item.slug || '').toLowerCase();
  if (slug.endsWith('-custom')) return true;
  const badgeClass = String(item.asset?.badgeClass || '').toLowerCase();
  return badgeClass.startsWith('badge-custom');
}

export function canCustomizeBadgeLabel(item) {
  if (!item) return false;
  const slug = String(item.slug || '').toLowerCase();
  if (BADGE_LABEL_EXCLUDED_SLUGS.has(slug)) return false;
  if (item.asset?.customizableLabel) return true;
  if (slug.endsWith('-custom')) return true;
  const badgeClass = String(item.asset?.badgeClass || '').toLowerCase();
  return badgeClass.startsWith('badge-custom');
}

export function getBadgeDisplayLabel(badge) {
  if (!badge) return '';
  const asset = badge.asset || {};
  const customization = badge.customization || {};
  const isCustom = isCustomBadgeItem(badge) || String(badge.slug || '').endsWith('-custom');

  if (canCustomizeBadgeLabel(badge) && customization.customLabelStatus === 'approved' && customization.customLabel) {
    return String(customization.customLabel).trim();
  }

  return String(asset.label || badge.name || '').trim();
}
