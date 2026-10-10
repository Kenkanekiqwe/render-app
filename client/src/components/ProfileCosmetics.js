import React, { useId, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import AvatarImage from './AvatarImage';
import { getBadgeIconUrl, getStaffBadgeIconUrl, getBadgeDisplayLabel, canCustomizeBadgeLabel, isCustomBadgeItem } from '../utils/badgeIcons';
import {
  MINIMAL_COLOR_PRESETS,
  buildNeonCssVars,
  buildNameCssVars,
  getNeonGradient,
  getNameGradient,
  getDefaultNameGradient,
  nameGradientToShimmerCss,
  isMinimalCustomizable,
  isNameColorCustomizable,
  isNeonCustomizable,
  neonGradientToLinearCss,
  normalizeGradient,
  normalizeHexColor,
} from '../utils/frameCustomization';
import './ProfileCosmetics.css';

export {
  isMinimalCustomizable,
  isNeonCustomizable,
  isNameColorCustomizable,
  isFrameCustomizable,
  isCosmeticCustomizable,
  hasGradientCustomization,
} from '../utils/frameCustomization';

export function isCustomizableFrame(item) {
  return isMinimalCustomizable(item);
}

export function isAnimatedNeonFrame(item) {
  return isNeonCustomizable(item);
}

export function getFrameClass(equipped) {
  return equipped?.frame?.asset?.frameClass || '';
}

export function getNameColorClass(equipped) {
  return equipped?.nameColor?.asset?.colorClass || '';
}

export function getBadgeClass(equipped) {
  return equipped?.badge?.asset?.badgeClass || '';
}

export function getFrameColor(frameItem, overrideColor) {
  if (overrideColor) return normalizeHexColor(overrideColor, frameItem?.asset?.defaultColor || '#e8eaef');
  return normalizeHexColor(
    frameItem?.customization?.frameColor || frameItem?.asset?.defaultColor,
    '#e8eaef'
  );
}

export function getFrameStyle(equipped, customization = {}) {
  const frameClass = getFrameClass(equipped);
  const frame = equipped?.frame;
  if (frameClass === 'frame-minimal') {
    const color = getFrameColor(frame, customization.frameColor);
    return { '--frame-color': color };
  }
  if (frameClass === 'frame-neon') {
    const gradient = getNeonGradient(frame, customization.neonGradient);
    return buildNeonCssVars(gradient);
  }
  return undefined;
}

export function buildEquippedFrame(item, customization = null) {
  if (!item) return null;
  const nextCustomization = customization
    ? { ...(item.customization || {}), ...customization }
    : (item.customization || {});
  return {
    frame: {
      ...item,
      customization: nextCustomization,
    },
  };
}

function MinimalColorPanel({ itemId, color, onChange, label }) {
  const inputRef = useRef(null);
  const inputId = useId();

  const setColor = (next) => {
    onChange?.(normalizeHexColor(next, color));
  };

  return (
    <div className="mp-frame-custom mp-frame-custom--minimal">
      <span className="mp-frame-custom__label">{label}</span>
      <button
        type="button"
        className="mp-frame-custom__hero"
        style={{ '--mp-swatch-color': color }}
        onClick={() => inputRef.current?.click()}
        aria-label={label}
      >
        <span className="mp-frame-custom__hero-ring" aria-hidden="true" />
        <span className="mp-frame-custom__hero-core" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="color"
        className="mp-frame-custom__native"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        tabIndex={-1}
      />
      <label className="mp-frame-custom__hex-wrap" htmlFor={`${inputId}-hex`}>
        <span>#</span>
        <input
          id={`${inputId}-hex`}
          type="text"
          className="mp-frame-custom__hex"
          value={color.replace('#', '')}
          maxLength={6}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
            if (raw.length === 6) setColor(`#${raw}`);
          }}
        />
      </label>
      <div className="mp-frame-custom__presets" role="listbox" aria-label={label}>
        {MINIMAL_COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            role="option"
            aria-selected={preset === color}
            className={`mp-frame-custom__preset${preset === color ? ' is-active' : ''}`}
            style={{ '--mp-preset-color': preset }}
            onClick={() => setColor(preset)}
          />
        ))}
      </div>
    </div>
  );
}

function NeonColorChip({ color, label, onChange }) {
  const inputRef = useRef(null);
  const inputId = useId();

  const setColor = (next) => {
    onChange?.(normalizeHexColor(next, color));
  };

  return (
    <div className="mp-frame-custom__color-chip">
      <button
        type="button"
        className="mp-frame-custom__chip-btn"
        style={{ '--mp-chip-color': color }}
        onClick={() => inputRef.current?.click()}
        aria-label={label}
      >
        <span aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="color"
        className="mp-frame-custom__native"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        tabIndex={-1}
      />
      <span className="mp-frame-custom__chip-label">{label}</span>
      <label className="mp-frame-custom__hex-wrap mp-frame-custom__hex-wrap--compact" htmlFor={`${inputId}-hex`}>
        <span>#</span>
        <input
          id={`${inputId}-hex`}
          type="text"
          className="mp-frame-custom__hex"
          value={color.replace('#', '')}
          maxLength={6}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
            if (raw.length === 6) setColor(`#${raw}`);
          }}
        />
      </label>
    </div>
  );
}

function GradientPanel({
  gradient,
  onChange,
  labels,
  buildVars = buildNeonCssVars,
  previewCss = neonGradientToLinearCss,
  panelClassName = '',
  defaults = null,
}) {
  const normalized = normalizeGradient(gradient, defaults || undefined);
  const [stop1, stop2] = normalized.stops;

  const updateGradient = (patch) => {
    onChange?.(normalizeGradient({ ...normalized, ...patch }, defaults || undefined));
  };

  const updateColor = (index, color) => {
    const colors = [...normalized.colors];
    colors[index] = normalizeHexColor(color, colors[index]);
    updateGradient({ colors });
  };

  const updateStop = (index, value) => {
    const stops = [...normalized.stops];
    stops[index] = value;
    if (index === 0) {
      stops[1] = Math.max(stops[1], value + 5);
    } else {
      stops[0] = Math.min(stops[0], value - 5);
    }
    updateGradient({ stops });
  };

  return (
    <div className={`mp-frame-custom mp-frame-custom--neon${panelClassName ? ` ${panelClassName}` : ''}`}>
      <span className="mp-frame-custom__label">{labels.title}</span>
      <div
        className="mp-frame-custom__gradient-preview"
        style={{
          background: previewCss(normalized),
          ...buildVars(normalized),
        }}
        aria-hidden="true"
      />
      <div className="mp-frame-custom__colors">
        {normalized.colors.map((color, index) => (
          <NeonColorChip
            key={index}
            color={color}
            label={labels.colorLabels[index]}
            onChange={(next) => updateColor(index, next)}
          />
        ))}
      </div>
      <div className="mp-frame-custom__stops">
        <div className="mp-frame-custom__stop">
          <div className="mp-frame-custom__stop-head">
            <span>{labels.stop1}</span>
            <strong>{stop1}%</strong>
          </div>
          <input
            type="range"
            min={10}
            max={80}
            value={stop1}
            className="mp-frame-custom__range"
            onChange={(e) => updateStop(0, Number(e.target.value))}
          />
        </div>
        <div className="mp-frame-custom__stop">
          <div className="mp-frame-custom__stop-head">
            <span>{labels.stop2}</span>
            <strong>{stop2}%</strong>
          </div>
          <input
            type="range"
            min={stop1 + 5}
            max={95}
            value={stop2}
            className="mp-frame-custom__range"
            onChange={(e) => updateStop(1, Number(e.target.value))}
          />
        </div>
        <div className="mp-frame-custom__stop">
          <div className="mp-frame-custom__stop-head">
            <span>{labels.speed || 'Speed'}</span>
            <strong>{normalized.speed}s</strong>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={normalized.speed}
            className="mp-frame-custom__range"
            onChange={(e) => updateGradient({ speed: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

export function CosmeticCustomizeModal({
  open,
  item,
  fallbackName = 'R',
  customization = {},
  onChange,
  onClose,
  labels = {},
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !item) return null;

  const isMinimal = isMinimalCustomizable(item);
  const isNeon = isNeonCustomizable(item);
  const isName = isNameColorCustomizable(item);
  const defaults = isName ? getDefaultNameGradient(item) : null;
  const color = getFrameColor(item, customization.frameColor);
  const neonGradient = getNeonGradient(item, customization.neonGradient);
  const nameGradient = getNameGradient(item, customization.nameGradient);
  const gradientLabels = {
    title: labels.gradient || 'Gradient',
    colorLabels: labels.colorLabels || ['1', '2', '3'],
    stop1: labels.stop1 || 'Stop 1',
    stop2: labels.stop2 || 'Stop 2',
    speed: labels.speed || 'Speed',
  };

  const nameEquipped = {
    nameColor: {
      ...item,
      slug: item.slug || 'color-rainbow',
      asset: { ...(item.asset || {}), colorClass: item.asset?.colorClass || 'name-rainbow' },
      customization: { ...(item.customization || {}), nameGradient },
    },
  };

  return createPortal(
    <div
      className="mp-gradient-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mp-gradient-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="mp-gradient-modal__panel">
        <div className="mp-gradient-modal__head">
          <div>
            <p className="mp-gradient-modal__kicker">
              {isMinimal ? (labels.color || 'Color') : (labels.gradient || 'Gradient')}
            </p>
            <h3 id="mp-gradient-modal-title">{item.name}</h3>
          </div>
          <button type="button" className="mp-gradient-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="mp-gradient-modal__layout">
          <div className={`mp-gradient-modal__preview${isName ? ' mp-gradient-modal__preview--name' : ''}`}>
            {(isMinimal || isNeon) && (
              <CosmeticAvatar
                url=""
                fallback={fallbackName[0] || 'R'}
                alt={item.name}
                equipped={buildEquippedFrame(item, isMinimal ? { frameColor: color } : { neonGradient })}
                className="marketplace-preview-frame"
                cosmeticCustomization={isMinimal ? { frameColor: color } : { neonGradient }}
              />
            )}
            {isName && (
              <CosmeticName
                equipped={nameEquipped}
                className="marketplace-preview-name"
                cosmeticCustomization={{ nameGradient }}
              >
                {fallbackName}
              </CosmeticName>
            )}
          </div>

          <div className="mp-gradient-modal__controls">
            {isMinimal && (
              <MinimalColorPanel
                itemId={item.id}
                color={color}
                label={labels.color || 'Color'}
                onChange={(nextColor) => onChange?.({ frameColor: nextColor })}
              />
            )}

            {(isNeon || isName) && (
              <GradientPanel
                gradient={isName ? nameGradient : neonGradient}
                defaults={defaults}
                buildVars={isName ? (gradient) => buildNameCssVars(gradient, defaults) : buildNeonCssVars}
                previewCss={isName ? (gradient) => nameGradientToShimmerCss(gradient, defaults) : neonGradientToLinearCss}
                panelClassName={isName ? 'mp-frame-custom--name' : ''}
                labels={gradientLabels}
                onChange={(nextGradient) => onChange?.(isName ? { nameGradient: nextGradient } : { neonGradient: nextGradient })}
              />
            )}

            <button type="button" className="mp-btn mp-btn--buy mp-gradient-modal__done" onClick={onClose}>
              {labels.done || 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export const GradientCustomizeModal = CosmeticCustomizeModal;

export function CosmeticAvatar({ url, fallback, alt, equipped, className = '', size, frameColor, frameCustomization, cosmeticCustomization }) {
  const frameClass = getFrameClass(equipped);
  const customization = {
    ...(cosmeticCustomization || frameCustomization || {}),
    ...(frameColor ? { frameColor } : {}),
  };
  const style = {
    ...(size ? { width: size, height: size } : {}),
    ...getFrameStyle(equipped, customization),
  };

  return (
    <div
      className={`cosmetic-avatar${frameClass ? ` ${frameClass}` : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {frameClass && <span className="cosmetic-avatar__frame" aria-hidden="true" />}
      <div className="cosmetic-avatar__inner">
        <AvatarImage url={url} fallback={fallback} alt={alt} />
      </div>
    </div>
  );
}

export function CosmeticName({ children, equipped, className = '', as: Tag = 'span', nameCustomization, cosmeticCustomization }) {
  const nameItem = equipped?.nameColor;
  const custom = nameCustomization || cosmeticCustomization;
  const isRainbow = nameItem?.slug === 'color-rainbow' || nameItem?.asset?.colorClass === 'name-rainbow';
  const colorClass = !isRainbow ? (nameItem?.asset?.colorClass || '') : '';
  const defaults = getDefaultNameGradient(nameItem);
  const style = isRainbow
    ? buildNameCssVars(getNameGradient(nameItem, custom?.nameGradient), defaults)
    : undefined;

  return (
    <Tag
      className={`cosmetic-name${colorClass ? ` ${colorClass}` : ''}${isRainbow ? ' name-custom-shimmer' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function CosmeticBadge({ equipped, className = '' }) {
  const badge = equipped?.badge;
  if (!badge) return null;

  const badgeClass = badge.asset?.badgeClass || '';
  const label = badge.displayLabel || getBadgeDisplayLabel(badge);
  const iconUrl = getBadgeIconUrl(badge);

  return (
    <span
      className={`cosmetic-badge cosmetic-badge--icon${badgeClass ? ` ${badgeClass}` : ''}${className ? ` ${className}` : ''}`}
      tabIndex={0}
    >
      <span className="cosmetic-badge__icon" aria-hidden="true">
        {iconUrl ? <img src={iconUrl} alt="" draggable={false} /> : (badge.asset?.icon || '•')}
      </span>
      {label && (
        <span className="cosmetic-badge__tooltip" role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}

export function CosmeticBadges({ equipped, className = '' }) {
  const badges = [equipped?.badge, equipped?.badge2].filter(Boolean);
  if (!badges.length) return null;

  return (
    <span className={`cosmetic-badges${className ? ` ${className}` : ''}`}>
      {badges.map((badge, index) => (
        <CosmeticBadge key={`${badge.id || badge.slug || 'badge'}-${index}`} equipped={{ badge }} />
      ))}
    </span>
  );
}

export { isCustomBadgeItem, canCustomizeBadgeLabel, getBadgeDisplayLabel };

export function AdminPlaque({ isAdmin, className = '' }) {
  if (!isAdmin) return null;
  const iconUrl = getStaffBadgeIconUrl();
  return (
    <span
      className={`cosmetic-badge cosmetic-badge--icon badge-staff admin-plaque${className ? ` ${className}` : ''}`}
      tabIndex={0}
    >
      <span className="cosmetic-badge__icon" aria-hidden="true">
        <img src={iconUrl} alt="" draggable={false} />
      </span>
      <span className="cosmetic-badge__tooltip" role="tooltip">
        Staff
      </span>
    </span>
  );
}

export function FrameMarketplacePreview({
  item,
  fallbackName = 'R',
  frameCustomization,
  onFrameCustomizationChange,
  cosmeticCustomization,
  onCosmeticCustomizationChange,
  labels = {},
}) {
  if (!item) return null;

  const customization = cosmeticCustomization || frameCustomization;
  const onChange = onCosmeticCustomizationChange || onFrameCustomizationChange;
  const minimal = isMinimalCustomizable(item);
  const neon = isNeonCustomizable(item);
  const color = getFrameColor(item, customization?.frameColor);
  const neonGradient = getNeonGradient(item, customization?.neonGradient);
  const equipped = buildEquippedFrame(
    item,
    minimal || neon
      ? {
          ...(minimal ? { frameColor: color } : {}),
          ...(neon ? { neonGradient } : {}),
        }
      : null
  );

  return (
    <CosmeticAvatar
      url=""
      fallback={fallbackName[0] || 'R'}
      alt={item.name}
      equipped={equipped}
      className="marketplace-preview-frame"
      frameCustomization={customization}
      cosmeticCustomization={customization}
    />
  );
}

export function NameColorMarketplacePreview({
  item,
  fallbackName = 'R',
  demoLabel,
  cosmeticCustomization,
}) {
  if (!item) return null;
  const nameGradient = getNameGradient(item, cosmeticCustomization?.nameGradient);
  const equipped = {
    nameColor: {
      ...item,
      slug: item.slug || 'color-rainbow',
      asset: { ...(item.asset || {}), colorClass: item.asset?.colorClass || 'name-rainbow' },
      customization: { ...(item.customization || {}), nameGradient },
    },
  };

  return (
    <div className="marketplace-preview-card marketplace-preview-card--name">
      {demoLabel && <span className="marketplace-preview-name-demo">{demoLabel}</span>}
      <CosmeticName equipped={equipped} className="marketplace-preview-name" cosmeticCustomization={{ nameGradient }}>
        {fallbackName}
      </CosmeticName>
    </div>
  );
}

export function MarketplaceItemPreview({
  item,
  fallbackName = 'R',
  demoLabel,
  frameCustomization,
  onFrameCustomizationChange,
  cosmeticCustomization,
  onCosmeticCustomizationChange,
  labels = {},
}) {
  if (!item) return null;

  const customization = cosmeticCustomization || frameCustomization;
  const onChange = onCosmeticCustomizationChange || onFrameCustomizationChange;
  const { itemType, name } = item;

  if (itemType === 'frame') {
    if (isMinimalCustomizable(item) || isNeonCustomizable(item)) {
      return (
        <div className="marketplace-preview-card marketplace-preview-card--frame">
          <FrameMarketplacePreview
            item={item}
            fallbackName={fallbackName}
            cosmeticCustomization={customization}
            onCosmeticCustomizationChange={onChange}
            labels={labels}
          />
        </div>
      );
    }

    const equipped = buildEquippedFrame(item);
    return (
      <div className="marketplace-preview-card marketplace-preview-card--frame">
        <CosmeticAvatar
          url=""
          fallback={fallbackName[0] || 'R'}
          alt={name}
          equipped={equipped}
          className="marketplace-preview-frame"
        />
      </div>
    );
  }

  if (itemType === 'name_color') {
    if (isNameColorCustomizable(item)) {
      return (
        <NameColorMarketplacePreview
          item={item}
          fallbackName={fallbackName}
          demoLabel={demoLabel}
          cosmeticCustomization={customization}
        />
      );
    }
    const equipped = { nameColor: item };
    return (
      <div className="marketplace-preview-card marketplace-preview-card--name">
        {demoLabel && <span className="marketplace-preview-name-demo">{demoLabel}</span>}
        <CosmeticName equipped={equipped} className="marketplace-preview-name">
          {fallbackName}
        </CosmeticName>
      </div>
    );
  }

  if (itemType === 'badge') {
    const equipped = { badge: item };
    return (
      <div className="marketplace-preview-card marketplace-preview-card--badge">
        <CosmeticBadge equipped={equipped} />
      </div>
    );
  }

  return null;
}
