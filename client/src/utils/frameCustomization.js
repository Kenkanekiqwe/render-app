export const DEFAULT_NEON_GRADIENT = {
  colors: ['#7c5cff', '#00d4ff', '#ff6bcb'],
  stops: [33, 66],
  speed: 4,
};

export const DEFAULT_NAME_GRADIENTS = {
  'color-rainbow': { colors: ['#ff6bcb', '#9b7bff', '#4ecbff'], stops: [33, 66], speed: 3 },
};

export const MINIMAL_COLOR_PRESETS = [
  '#ffffff',
  '#e8eaef',
  '#7c5cff',
  '#00d4ff',
  '#ff6bcb',
  '#ffe08a',
  '#7fff7c',
  '#ff5e8a',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value, fallback = '#e8eaef') {
  const color = String(value || '').trim();
  return HEX_RE.test(color) ? color.toLowerCase() : fallback;
}

export function normalizeAnimationSpeed(value, fallback = 4) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return fallback;
  return Math.min(12, Math.max(1, Math.round(speed * 10) / 10));
}

export function normalizeGradient(raw, defaults = DEFAULT_NEON_GRADIENT) {
  const base = defaults || DEFAULT_NEON_GRADIENT;
  const source = raw && typeof raw === 'object' ? raw : {};
  const colors = (Array.isArray(source.colors) ? source.colors : base.colors)
    .slice(0, 3)
    .map((color, index) => normalizeHexColor(color, base.colors[index] || base.colors[0]));
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

export const normalizeNeonGradient = normalizeGradient;

export function getDefaultNameGradient(item) {
  return (
    item?.asset?.defaultNameGradient
    || DEFAULT_NAME_GRADIENTS[item?.slug]
    || DEFAULT_NAME_GRADIENTS['color-rainbow']
  );
}

export function getNeonGradient(frameItem, overrideGradient) {
  if (overrideGradient) return normalizeGradient(overrideGradient);
  if (frameItem?.customization?.neonGradient) {
    return normalizeGradient(frameItem.customization.neonGradient);
  }
  if (frameItem?.asset?.defaultNeonGradient) {
    return normalizeGradient(frameItem.asset.defaultNeonGradient);
  }
  return normalizeGradient(DEFAULT_NEON_GRADIENT);
}

export function getNameGradient(nameItem, overrideGradient) {
  const defaults = getDefaultNameGradient(nameItem);
  if (overrideGradient) return normalizeGradient(overrideGradient, defaults);
  if (nameItem?.customization?.nameGradient) {
    return normalizeGradient(nameItem.customization.nameGradient, defaults);
  }
  return normalizeGradient(defaults, defaults);
}

export function nameGradientToShimmerCss(gradient, defaults = DEFAULT_NAME_GRADIENTS['color-rainbow']) {
  const { colors, stops } = normalizeGradient(gradient, defaults);
  const [s1, s2] = stops;
  const [c1, c2, c3] = colors;
  const half1 = (s1 / 2).toFixed(2);
  const half2 = (s2 / 2).toFixed(2);
  const mid1 = (50 + s1 / 2).toFixed(2);
  const mid2 = (50 + s2 / 2).toFixed(2);
  return `linear-gradient(90deg, ${c1} 0%, ${c2} ${half1}%, ${c3} ${half2}%, ${c1} 50%, ${c2} ${mid1}%, ${c3} ${mid2}%, ${c1} 100%)`;
}

export function buildNeonCssVars(gradient) {
  const { colors, stops, speed } = normalizeGradient(gradient);
  return {
    '--neon-c1': colors[0],
    '--neon-c2': colors[1],
    '--neon-c3': colors[2],
    '--neon-s1': `${stops[0]}%`,
    '--neon-s2': `${stops[1]}%`,
    '--neon-speed': `${speed}s`,
  };
}

export function buildNameCssVars(gradient, defaults = DEFAULT_NAME_GRADIENTS['color-rainbow']) {
  const normalized = normalizeGradient(gradient, defaults);
  return {
    '--name-bg': nameGradientToShimmerCss(normalized, defaults),
    '--name-speed': `${normalized.speed}s`,
  };
}

export function neonGradientToCss(gradient) {
  const { colors, stops } = normalizeGradient(gradient);
  return `conic-gradient(from 0deg, ${colors[0]} 0%, ${colors[1]} ${stops[0]}%, ${colors[2]} ${stops[1]}%, ${colors[0]} 100%)`;
}

export function neonGradientToLinearCss(gradient) {
  const { colors, stops } = normalizeGradient(gradient);
  return `linear-gradient(90deg, ${colors[0]} 0%, ${colors[1]} ${stops[0]}%, ${colors[2]} ${stops[1]}%, ${colors[0]} 100%)`;
}

export function resolveCosmeticCustomization(item, entry, localState = {}) {
  const fromItem = entry?.customization || item?.customization || {};
  return {
    frameColor: localState.frameColor
      ?? fromItem.frameColor
      ?? item?.asset?.defaultColor
      ?? '#e8eaef',
    neonGradient: normalizeGradient(
      localState.neonGradient
        ?? fromItem.neonGradient
        ?? item?.asset?.defaultNeonGradient
    ),
    nameGradient: normalizeGradient(
      localState.nameGradient
        ?? fromItem.nameGradient
        ?? getDefaultNameGradient(item)
    ),
  };
}

export const resolveFrameCustomization = resolveCosmeticCustomization;

export function buildCosmeticCustomizationPayload(customization, item) {
  const payload = {};
  if (isMinimalCustomizable(item) && customization?.frameColor) {
    payload.frameColor = normalizeHexColor(customization.frameColor, item?.asset?.defaultColor);
  }
  if (isNeonCustomizable(item) && customization?.neonGradient) {
    payload.neonGradient = normalizeGradient(customization.neonGradient);
  }
  if (isNameColorCustomizable(item) && customization?.nameGradient) {
    payload.nameGradient = normalizeGradient(customization.nameGradient, getDefaultNameGradient(item));
  }
  return payload;
}

export const buildCustomizationPayload = buildCosmeticCustomizationPayload;

export function isMinimalCustomizable(item) {
  return Boolean(item?.asset?.customizable) && item?.asset?.frameClass === 'frame-minimal';
}

export function isNeonCustomizable(item) {
  return item?.asset?.frameClass === 'frame-neon'
    || Boolean(item?.asset?.customizableGradient && item?.itemType === 'frame')
    || item?.slug === 'frame-neon';
}

export function isNameColorCustomizable(item) {
  return item?.itemType === 'name_color' && (
    item?.slug === 'color-rainbow'
    || item?.asset?.colorClass === 'name-rainbow'
  );
}

export function isFrameCustomizable(item) {
  return isMinimalCustomizable(item) || isNeonCustomizable(item);
}

export function isCosmeticCustomizable(item) {
  return isFrameCustomizable(item) || isNameColorCustomizable(item);
}

export function hasGradientCustomization(item) {
  return isNeonCustomizable(item) || isNameColorCustomizable(item);
}

export function hasCosmeticCustomizeButton(item) {
  return isMinimalCustomizable(item) || hasGradientCustomization(item);
}
