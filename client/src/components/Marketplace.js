import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Marketplace.css';
import {
  FaCoins,
  FaShoppingBag,
  FaBox,
  FaExchangeAlt,
  FaCheck,
  FaTimes,
  FaWrench,
  FaTag,
} from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import Workshop from './Workshop';
import AvatarImage from './AvatarImage';
import { MarketplaceItemPreview, canCustomizeBadgeLabel, CosmeticCustomizeModal } from './ProfileCosmetics';
import {
  buildCosmeticCustomizationPayload,
  isCosmeticCustomizable,
  hasCosmeticCustomizeButton,
  isMinimalCustomizable,
  resolveCosmeticCustomization as mergeCosmeticCustomization,
} from '../utils/frameCustomization';
import {
  fetchCatalog,
  fetchInventory,
  fetchListings,
  buyItem,
  equipItem,
  unequipSlot,
  listItem,
  unlistItem,
  buyListing,
  customizeFrame,
  customizeBadgeLabel,
} from '../utils/marketplace';

const SHOP_TABS = [
  { id: 'shop', icon: FaShoppingBag, labelKey: 'marketplaceTabShop' },
  { id: 'inventory', icon: FaBox, labelKey: 'marketplaceTabInventory' },
  { id: 'resale', icon: FaExchangeAlt, labelKey: 'marketplaceTabResale' },
  { id: 'workshop', icon: FaWrench, labelKey: 'marketplaceTabWorkshop' },
];

const TYPE_FILTERS = ['all', 'frame', 'name_color', 'badge'];

const TYPE_SECTIONS = [
  { type: 'frame', labelKey: 'marketplaceSectionFrames' },
  { type: 'name_color', labelKey: 'marketplaceSectionNames' },
  { type: 'badge', labelKey: 'marketplaceSectionBadges' },
];

const SLOT_BY_TYPE = {
  frame: 'frame',
  name_color: 'name_color',
  badge: 'badge',
  badge2: 'badge2',
};

const PREVIEW_GLOW = {
  common: 'rgba(255, 255, 255, 0.03)',
  rare: 'rgba(78, 203, 255, 0.08)',
  epic: 'rgba(155, 123, 255, 0.09)',
  legendary: 'rgba(251, 191, 36, 0.1)',
};

function isItemBusy(busyId, itemId, instanceId, itemType, action, unequipSlot) {
  if (!busyId) return false;
  if (busyId === itemId || busyId === instanceId) return true;
  if (action === 'unequip') {
    const slot = unequipSlot || SLOT_BY_TYPE[itemType];
    if (slot && busyId === `unequip-${slot}`) return true;
  }
  return false;
}

function RarityBadge({ rarity, t }) {
  if (!rarity) return null;
  return (
    <span className={`mp-tag mp-tag--${rarity}`}>
      {t(`marketplaceRarity_${rarity}`)}
    </span>
  );
}

function ItemCard({
  item,
  previewDemo,
  children,
  status,
  frameCustomization,
  onFrameCustomizationChange,
  cosmeticCustomization,
  onCosmeticCustomizationChange,
  customizationLabels,
}) {
  const { t } = useLanguage();
  if (!item) return null;

  const customization = cosmeticCustomization || frameCustomization;
  const onCustomizationChange = onCosmeticCustomizationChange || onFrameCustomizationChange;

  const rarity = item.asset?.rarity || 'common';
  const framePreview = item.itemType === 'frame';

  return (
    <article
      className={`mp-card mp-card--${rarity} mp-card--type-${item.itemType}`}
      style={{ '--mp-card-glow': PREVIEW_GLOW[rarity] || PREVIEW_GLOW.common }}
    >
      <div
        className={`mp-card__preview${framePreview ? ' mp-card__preview--frame' : ''}`}
      >
        <MarketplaceItemPreview
          item={item}
          fallbackName={previewDemo}
          demoLabel={t('marketplacePreviewDemo')}
          cosmeticCustomization={customization}
          onCosmeticCustomizationChange={onCustomizationChange}
          frameCustomization={customization}
          onFrameCustomizationChange={onCustomizationChange}
          labels={customizationLabels}
        />
      </div>
      <div className="mp-card__body">
        <div className="mp-card__head">
          <div className="mp-card__meta">
            <div className="mp-card__tags">
              <span className="mp-tag mp-tag--type">{t(`marketplaceType_${item.itemType}`)}</span>
              <RarityBadge rarity={rarity} t={t} />
            </div>
            <h3 className="mp-card__title">{item.name}</h3>
            {item.asset?.description && (
              <p className="mp-card__desc">{item.asset.description}</p>
            )}
          </div>
          {status}
        </div>
        {children}
      </div>
    </article>
  );
}

function BadgeLabelPanel({ entry, t, busy, onSave }) {
  const [label, setLabel] = useState(entry.customization?.customLabel || '');
  const status = entry.customization?.customLabelStatus;
  const statusText = status === 'pending'
    ? t('marketplaceBadgeLabelPending')
    : status === 'approved'
      ? t('marketplaceBadgeLabelApproved')
      : status === 'rejected'
        ? t('marketplaceBadgeLabelRejected')
        : '';

  return (
    <div className="mp-badge-label-panel">
      <label htmlFor={`badge-label-${entry.id}`}>{t('marketplaceBadgeLabelHint')}</label>
      {statusText ? (
        <span className={`mp-badge-label-status mp-badge-label-status--${status}`}>{statusText}</span>
      ) : null}
      <div className="mp-list-form">
        <input
          id={`badge-label-${entry.id}`}
          type="text"
          maxLength={32}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={entry.item?.asset?.label || entry.item?.name}
        />
        <button
          type="button"
          className="mp-btn mp-btn--soft"
          disabled={busy || !label.trim()}
          onClick={() => onSave(entry, label.trim())}
        >
          {t('marketplaceBadgeLabelSubmit')}
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mp-loading" aria-hidden="true">
      <div className="mp-skeleton" />
      <div className="mp-skeleton" />
      <div className="mp-skeleton" />
      <div className="mp-skeleton" />
    </div>
  );
}

function Marketplace({
  currentUserId,
  renderCoins: initialCoins = 0,
  onApplyWorkshopItem,
  onCosmeticsChange,
  onBalanceChange,
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('shop');
  const [typeFilter, setTypeFilter] = useState('all');
  const [catalogAll, setCatalogAll] = useState([]);
  const [inventory, setInventory] = useState({ items: [], equipped: null, equippedInstanceIds: {} });
  const [listings, setListings] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [renderCoins, setRenderCoins] = useState(initialCoins);
  const [initialLoading, setInitialLoading] = useState(true);
  const [resaleLoading, setResaleLoading] = useState(false);
  const [resaleLoaded, setResaleLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [listPrices, setListPrices] = useState({});
  const [listOpenId, setListOpenId] = useState(null);
  const [customizeModal, setCustomizeModal] = useState(null);
  const [frameCustomizations, setFrameCustomizations] = useState({});
  const saveTimersRef = useRef({});

  const previewDemo = t('marketplacePreviewDemo');
  const customizationLabels = {
    color: t('marketplaceFrameColor'),
    gradient: t('marketplaceFrameGradient'),
    colorLabels: [
      t('marketplaceFrameGradientColor1'),
      t('marketplaceFrameGradientColor2'),
      t('marketplaceFrameGradientColor3'),
    ],
    stop1: t('marketplaceFrameGradientStop1'),
    stop2: t('marketplaceFrameGradientStop2'),
    speed: t('marketplaceFrameGradientSpeed'),
    done: t('marketplaceCustomizeDone'),
  };

  const customizationKey = (item, entry = null) => (entry ? `i-${entry.id}` : `c-${item.id}`);

  const findOwnedEntry = useCallback(
    (item, entry = null) => entry || inventory.items?.find((row) => row.item?.id === item.id) || null,
    [inventory.items]
  );

  const getCosmeticCustomization = useCallback((item, entry = null) => {
    const ownedEntry = findOwnedEntry(item, entry);
    const key = customizationKey(item, ownedEntry);
    const catalogKey = customizationKey(item, null);
    const local = frameCustomizations[key] || frameCustomizations[catalogKey];
    return mergeCosmeticCustomization(item, ownedEntry, local || {});
  }, [findOwnedEntry, frameCustomizations]);

  const filteredCatalog = useMemo(() => {
    if (typeFilter === 'all') return catalogAll;
    return catalogAll.filter((item) => item.itemType === typeFilter);
  }, [catalogAll, typeFilter]);

  const filteredInventory = useMemo(() => {
    const items = inventory.items || [];
    if (typeFilter === 'all') return items;
    return items.filter((entry) => entry.item?.itemType === typeFilter);
  }, [inventory.items, typeFilter]);

  const filteredListings = useMemo(() => {
    if (typeFilter === 'all') return listings;
    return listings.filter((entry) => entry.item?.itemType === typeFilter);
  }, [listings, typeFilter]);

  const filteredMyListings = useMemo(() => {
    if (typeFilter === 'all') return myListings;
    return myListings.filter((entry) => entry.item?.itemType === typeFilter);
  }, [myListings, typeFilter]);

  const ownedItemIds = useMemo(
    () => new Set(inventory.items?.map((entry) => entry.item?.id) || []),
    [inventory.items]
  );

  const refreshInventory = useCallback(async () => {
    const data = await fetchInventory();
    setInventory(data);
    setRenderCoins(data.renderCoins ?? 0);
    onBalanceChange?.(data.renderCoins ?? 0);
    onCosmeticsChange?.(data.equipped);
    return data;
  }, [onBalanceChange, onCosmeticsChange]);

  const persistCosmeticCustomization = useCallback(async (item, entry, nextCustomization) => {
    if (!entry?.id || !isCosmeticCustomizable(item)) return;
    const payload = buildCosmeticCustomizationPayload(nextCustomization, item);
    if (!Object.keys(payload).length) return;

    try {
      const result = await customizeFrame(entry.id, payload);
      onCosmeticsChange?.(result.equipped);
      const data = await refreshInventory();
      const savedEntry = data.items?.find((row) => row.id === entry.id);
      if (savedEntry) {
        const savedCustomization = mergeCosmeticCustomization(item, savedEntry, savedEntry.customization || {});
        setFrameCustomizations((prev) => ({
          ...prev,
          [customizationKey(item, savedEntry)]: savedCustomization,
          [customizationKey(item, null)]: savedCustomization,
        }));
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceFrameColorError'));
    }
  }, [onCosmeticsChange, refreshInventory, t]);

  const handleCosmeticCustomizationChange = useCallback((item, entry, patch) => {
    const ownedEntry = findOwnedEntry(item, entry);
    const instanceKey = ownedEntry ? customizationKey(item, ownedEntry) : null;
    const catalogKey = customizationKey(item, null);
    let nextCustomization;

    setFrameCustomizations((prev) => {
      const base = mergeCosmeticCustomization(
        item,
        ownedEntry,
        (instanceKey && prev[instanceKey]) || prev[catalogKey] || {}
      );
      nextCustomization = {
        ...base,
        ...patch,
        ...(patch.neonGradient
          ? { neonGradient: { ...base.neonGradient, ...patch.neonGradient } }
          : {}),
        ...(patch.nameGradient
          ? { nameGradient: { ...base.nameGradient, ...patch.nameGradient } }
          : {}),
      };
      return {
        ...prev,
        [catalogKey]: nextCustomization,
        ...(instanceKey ? { [instanceKey]: nextCustomization } : {}),
      };
    });

    if (!ownedEntry?.id) return;

    const saveKey = String(ownedEntry.id);
    clearTimeout(saveTimersRef.current[saveKey]);
    saveTimersRef.current[saveKey] = window.setTimeout(() => {
      persistCosmeticCustomization(item, ownedEntry, nextCustomization);
    }, 300);
  }, [findOwnedEntry, persistCosmeticCustomization]);

  const refreshListings = useCallback(async () => {
    const [market, mine] = await Promise.all([
      fetchListings({ type: '' }),
      fetchListings({ mine: true }),
    ]);
    setListings(market);
    setMyListings(mine);
    setResaleLoaded(true);
  }, []);

  useEffect(() => {
    if (!inventory.items?.length) return;
    setFrameCustomizations((prev) => {
      const next = { ...prev };
      inventory.items.forEach((ownedEntry) => {
        const { item } = ownedEntry;
        if (!isCosmeticCustomizable(item) || !ownedEntry.customization) return;
        const hasSaved = ownedEntry.customization.frameColor
          || ownedEntry.customization.neonGradient
          || ownedEntry.customization.nameGradient;
        if (!hasSaved) return;
        const instanceKey = customizationKey(item, ownedEntry);
        const catalogKey = customizationKey(item, null);
        const saved = mergeCosmeticCustomization(item, ownedEntry, ownedEntry.customization);
        next[instanceKey] = saved;
        if (!next[catalogKey]) next[catalogKey] = saved;
      });
      return next;
    });
  }, [inventory.items]);

  useEffect(() => () => {
    Object.values(saveTimersRef.current).forEach((timerId) => clearTimeout(timerId));
  }, []);

  useEffect(() => {
    setRenderCoins(initialCoins);
  }, [initialCoins]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInitialLoading(true);
      setError('');
      try {
        const [catalogData, invData] = await Promise.all([
          fetchCatalog('', { shop: true }),
          fetchInventory(),
        ]);
        if (cancelled) return;
        setCatalogAll(catalogData);
        setInventory(invData);
        setRenderCoins(invData.renderCoins ?? 0);
        onBalanceChange?.(invData.renderCoins ?? 0);
        onCosmeticsChange?.(invData.equipped);
      } catch {
        if (!cancelled) setError(t('marketplaceLoadError'));
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onBalanceChange, onCosmeticsChange, t]);

  useEffect(() => {
    if (tab !== 'resale' || resaleLoaded) return undefined;
    let cancelled = false;
    (async () => {
      setResaleLoading(true);
      try {
        await refreshListings();
      } catch {
        if (!cancelled) setError(t('marketplaceLoadError'));
      } finally {
        if (!cancelled) setResaleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, resaleLoaded, refreshListings, t]);

  const handleBuy = async (itemId) => {
    setBusyId(itemId);
    setError('');
    try {
      const result = await buyItem(itemId);
      setRenderCoins(result.balance);
      onBalanceChange?.(result.balance);
      await refreshInventory();
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceBuyError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleEquip = async (instanceId, item, entry) => {
    setBusyId(instanceId);
    setError('');
    try {
      const ownedEntry = findOwnedEntry(item, entry);
      const customization = isCosmeticCustomizable(item)
        ? buildCosmeticCustomizationPayload(getCosmeticCustomization(item, ownedEntry), item)
        : undefined;
      const result = await equipItem(instanceId, customization);
      onCosmeticsChange?.(result.equipped);
      await refreshInventory();
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceEquipError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnequip = async (entryOrType) => {
    let slot;
    if (entryOrType && typeof entryOrType === 'object') {
      const entry = entryOrType;
      if (entry.item?.itemType === 'badge') {
        slot = getBadgeSlotKey(entry.id);
      } else {
        slot = SLOT_BY_TYPE[entry.item?.itemType];
      }
    } else {
      slot = SLOT_BY_TYPE[entryOrType];
    }
    if (!slot) return;
    setBusyId(`unequip-${slot}`);
    setError('');
    try {
      const result = await unequipSlot(slot);
      onCosmeticsChange?.(result.equipped);
      await refreshInventory();
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceEquipError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleList = async (instanceId) => {
    const price = Number(listPrices[instanceId]);
    if (!Number.isFinite(price) || price < 10) {
      setError(t('marketplaceListPriceHint'));
      return;
    }
    setBusyId(instanceId);
    setError('');
    try {
      await listItem(instanceId, price);
      setListPrices((prev) => ({ ...prev, [instanceId]: '' }));
      setListOpenId(null);
      await Promise.all([refreshInventory(), refreshListings()]);
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceListError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnlist = async (instanceId) => {
    setBusyId(instanceId);
    setError('');
    try {
      await unlistItem(instanceId);
      await Promise.all([refreshInventory(), refreshListings()]);
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceUnlistError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleBadgeLabelSave = async (entry, label) => {
    setBusyId(entry.id);
    setError('');
    try {
      await customizeBadgeLabel(entry.id, label);
      await refreshInventory();
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceBadgeLabelError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleBuyListing = async (instanceId) => {
    setBusyId(instanceId);
    setError('');
    try {
      const result = await buyListing(instanceId);
      setRenderCoins(result.balance);
      onBalanceChange?.(result.balance);
      await Promise.all([refreshInventory(), refreshListings()]);
    } catch (err) {
      setError(err?.response?.data?.error || t('marketplaceBuyError'));
    } finally {
      setBusyId(null);
    }
  };

  const isEquipped = (instanceId) => {
    const ids = inventory.equippedInstanceIds || {};
    return Object.values(ids).includes(instanceId);
  };

  const getBadgeSlotKey = (instanceId) => {
    const ids = inventory.equippedInstanceIds || {};
    if (ids.badge === instanceId) return 'badge';
    if (ids.badge2 === instanceId) return 'badge2';
    return null;
  };

  const renderCustomizeButton = (item, entry = null) => {
    if (!hasCosmeticCustomizeButton(item)) return null;
    const label = isMinimalCustomizable(item)
      ? t('marketplaceEditColor')
      : t('marketplaceEditGradient');
    return (
      <button
        type="button"
        className="mp-btn mp-btn--customize"
        onClick={() => setCustomizeModal({ item, entry: findOwnedEntry(item, entry) })}
      >
        {label}
      </button>
    );
  };

  const renderShopCard = (item) => {
    const owned = ownedItemIds.has(item.id);
    const ownedEntry = findOwnedEntry(item);
    const canBuy = !owned && renderCoins >= item.priceCoins;

    return (
      <ItemCard
        key={item.id}
        item={item}
        previewDemo={previewDemo}
        cosmeticCustomization={isCosmeticCustomizable(item) ? getCosmeticCustomization(item, ownedEntry) : undefined}
        onCosmeticCustomizationChange={
          isCosmeticCustomizable(item)
            ? (patch) => handleCosmeticCustomizationChange(item, ownedEntry, patch)
            : undefined
        }
        frameCustomization={isCosmeticCustomizable(item) ? getCosmeticCustomization(item, ownedEntry) : undefined}
        onFrameCustomizationChange={
          isCosmeticCustomizable(item)
            ? (patch) => handleCosmeticCustomizationChange(item, ownedEntry, patch)
            : undefined
        }
        customizationLabels={customizationLabels}
        status={
          owned ? <span className="mp-status mp-status--owned">{t('marketplaceOwned')}</span> : null
        }
      >
        <div className="mp-card__footer">
          {renderCustomizeButton(item, ownedEntry)}
          <div className="mp-card__price-row">
            <span className="mp-price">
              {item.priceCoins}
              <small>RC</small>
            </span>
            <button
              type="button"
              className="mp-btn mp-btn--buy"
              disabled={owned || isItemBusy(busyId, item.id) || !canBuy}
              onClick={() => handleBuy(item.id)}
            >
              {owned ? t('marketplaceOwned') : t('marketplaceBuy')}
            </button>
          </div>
        </div>
      </ItemCard>
    );
  };

  const renderShop = () => {
    if (typeFilter !== 'all') {
      return <div className="mp-grid">{filteredCatalog.map(renderShopCard)}</div>;
    }

    return TYPE_SECTIONS.map(({ type, labelKey }) => {
      const items = filteredCatalog.filter((item) => item.itemType === type);
      if (!items.length) return null;
      return (
        <section key={type} className="mp-section">
          <div className="mp-section__head">
            <h2 className="mp-section__title">{t(labelKey)}</h2>
            <span className="mp-section__badge">{items.length}</span>
          </div>
          <div className="mp-grid">{items.map(renderShopCard)}</div>
        </section>
      );
    });
  };

  const renderInventoryCard = (entry) => {
    const { item } = entry;
    const equipped = isEquipped(entry.id);
    const listed = Boolean(entry.listedAt);
    const showListPanel = listOpenId === entry.id;

    return (
      <ItemCard
        key={entry.id}
        item={item}
        previewDemo={previewDemo}
        cosmeticCustomization={isCosmeticCustomizable(item) ? getCosmeticCustomization(item, entry) : undefined}
        onCosmeticCustomizationChange={
          isCosmeticCustomizable(item)
            ? (patch) => handleCosmeticCustomizationChange(item, entry, patch)
            : undefined
        }
        frameCustomization={isCosmeticCustomizable(item) ? getCosmeticCustomization(item, entry) : undefined}
        onFrameCustomizationChange={
          isCosmeticCustomizable(item)
            ? (patch) => handleCosmeticCustomizationChange(item, entry, patch)
            : undefined
        }
        customizationLabels={customizationLabels}
        status={
          equipped ? (
            <span className="mp-status mp-status--equipped">
              {item.itemType === 'badge'
                ? (getBadgeSlotKey(entry.id) === 'badge2' ? t('marketplaceEquippedSlot2') : t('marketplaceEquippedSlot1'))
                : t('marketplaceEquipped')}
            </span>
          ) : listed ? (
            <span className="mp-status mp-status--listed">
              {entry.listingPrice} RC
            </span>
          ) : null
        }
      >
        <div className="mp-card__footer">
          {renderCustomizeButton(item, entry)}
          {!listed && (
            <div className={`mp-actions${item?.isTradable && !equipped ? ' mp-actions--2' : ''}`}>
              {equipped ? (
                <button
                  type="button"
                  className="mp-btn mp-btn--soft"
                  disabled={isItemBusy(
                    busyId,
                    null,
                    entry.id,
                    item.itemType,
                    'unequip',
                    item.itemType === 'badge' ? getBadgeSlotKey(entry.id) : undefined
                  )}
                  onClick={() => handleUnequip(entry)}
                >
                  <FaTimes /> {t('marketplaceUnequip')}
                </button>
              ) : (
                <button
                  type="button"
                  className="mp-btn mp-btn--buy"
                  disabled={isItemBusy(busyId, null, entry.id)}
                  onClick={() => handleEquip(entry.id, item, entry)}
                >
                  <FaCheck /> {t('marketplaceEquip')}
                </button>
              )}
              {item?.isTradable && !equipped && (
                <button
                  type="button"
                  className="mp-btn mp-btn--soft"
                  disabled={isItemBusy(busyId, null, entry.id)}
                  onClick={() => setListOpenId(showListPanel ? null : entry.id)}
                >
                  <FaTag /> {t('marketplaceSell')}
                </button>
              )}
            </div>
          )}
          {showListPanel && !listed && (
            <div className="mp-list-panel">
              <label htmlFor={`list-price-${entry.id}`}>{t('marketplaceSellHint')}</label>
              <div className="mp-list-form">
                <input
                  id={`list-price-${entry.id}`}
                  type="number"
                  min="10"
                  placeholder={t('marketplacePricePlaceholder')}
                  value={listPrices[entry.id] ?? ''}
                  onChange={(e) => setListPrices((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="mp-btn mp-btn--buy"
                  disabled={isItemBusy(busyId, null, entry.id)}
                  onClick={() => handleList(entry.id)}
                >
                  {t('marketplaceList')}
                </button>
              </div>
            </div>
          )}
          {canCustomizeBadgeLabel(item) && !listed && (
            <BadgeLabelPanel
              entry={entry}
              t={t}
              busy={isItemBusy(busyId, null, entry.id)}
              onSave={handleBadgeLabelSave}
            />
          )}
          {listed && (
            <div className="mp-actions">
              <button
                type="button"
                className="mp-btn mp-btn--danger"
                disabled={isItemBusy(busyId, null, entry.id)}
                onClick={() => handleUnlist(entry.id)}
              >
                {t('marketplaceUnlist')}
              </button>
            </div>
          )}
        </div>
      </ItemCard>
    );
  };

  const renderListingCard = (entry, { isMine = false } = {}) => (
    <ItemCard
      key={entry.id}
      item={entry.item}
      previewDemo={previewDemo}
      status={
        <span className="mp-price">
          {entry.listingPrice}
          <small>RC</small>
        </span>
      }
    >
      {!isMine && entry.seller && (
        <div className="mp-seller">
          <AvatarImage
            url={entry.seller.avatarUrl}
            fallback={(entry.seller.displayName || entry.seller.username || '?')[0]}
            alt=""
          />
          <span>{entry.seller.displayName || entry.seller.username}</span>
        </div>
      )}
      <div className="mp-card__footer">
        <div className="mp-card__price-row">
          <span className="mp-price">
            {entry.listingPrice}
            <small>RC</small>
          </span>
          <button
            type="button"
            className={`mp-btn ${isMine ? 'mp-btn--danger' : 'mp-btn--buy'}`}
            disabled={isItemBusy(busyId, null, entry.id) || (!isMine && renderCoins < entry.listingPrice)}
            onClick={() => (isMine ? handleUnlist(entry.id) : handleBuyListing(entry.id))}
          >
            {isMine ? t('marketplaceUnlist') : t('marketplaceBuyListing')}
          </button>
        </div>
      </div>
    </ItemCard>
  );

  const tabLoading = initialLoading || (tab === 'resale' && resaleLoading && !resaleLoaded);

  return (
    <div className="mp-store">
      <header className="mp-header">
        <div className="mp-header__row">
          <div className="mp-header__brand">
            <h1>{t('marketplaceTitle')}</h1>
            <p>{t('marketplaceDesc')}</p>
          </div>
          <div className="mp-wallet">
            <div className="mp-wallet__icon">
              <FaCoins />
            </div>
            <div className="mp-wallet__text">
              <span className="mp-wallet__label">RenderCoin</span>
              <span className="mp-wallet__amount">{renderCoins.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="mp-tabs" role="tablist">
          {SHOP_TABS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`mp-tab${tab === id ? ' is-active' : ''}`}
              onClick={() => {
                setTab(id);
                setError('');
              }}
            >
              <Icon />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </header>

      {tab !== 'workshop' && (
        <div className="mp-filters">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              className={`mp-chip${typeFilter === type ? ' is-active' : ''}`}
              onClick={() => setTypeFilter(type)}
            >
              {type === 'all' ? t('marketplaceFilterAll') : t(`marketplaceType_${type}`)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mp-alert" role="alert">{error}</p>}

      {tab === 'workshop' && (
        <div className="mp-workshop">
          <Workshop currentUserId={currentUserId} onApplyItem={onApplyWorkshopItem} />
        </div>
      )}

      {tab !== 'workshop' && tabLoading && <LoadingSkeleton />}

      {tab === 'shop' && !tabLoading && filteredCatalog.length === 0 && (
        <p className="mp-empty">{t('marketplaceEmpty')}</p>
      )}
      {tab === 'shop' && !tabLoading && filteredCatalog.length > 0 && renderShop()}

      {tab === 'inventory' && !tabLoading && filteredInventory.length === 0 && (
        <p className="mp-empty">{t('marketplaceInventoryEmpty')}</p>
      )}
      {tab === 'inventory' && !tabLoading && filteredInventory.length > 0 && (
        <div className="mp-grid">{filteredInventory.map(renderInventoryCard)}</div>
      )}

      {tab === 'resale' && !tabLoading && filteredListings.length === 0 && filteredMyListings.length === 0 && (
        <p className="mp-empty">{t('marketplaceResaleEmpty')}</p>
      )}
      {tab === 'resale' && !tabLoading && (filteredListings.length > 0 || filteredMyListings.length > 0) && (
        <>
          {filteredMyListings.length > 0 && (
            <section className="mp-section">
              <div className="mp-section__head">
                <h2 className="mp-section__title">{t('marketplaceMyListings')}</h2>
                <span className="mp-section__badge">{filteredMyListings.length}</span>
              </div>
              <div className="mp-grid">
                {filteredMyListings.map((entry) => renderListingCard(entry, { isMine: true }))}
              </div>
            </section>
          )}
          {filteredListings.length > 0 && (
            <section className="mp-section">
              <div className="mp-section__head">
                <h2 className="mp-section__title">{t('marketplaceResaleMarket')}</h2>
                <span className="mp-section__badge">{filteredListings.length}</span>
              </div>
              <div className="mp-grid">
                {filteredListings.map((entry) => renderListingCard(entry))}
              </div>
            </section>
          )}
        </>
      )}

      {customizeModal && (
        <CosmeticCustomizeModal
          open
          item={customizeModal.item}
          fallbackName={previewDemo}
          customization={getCosmeticCustomization(customizeModal.item, customizeModal.entry)}
          labels={customizationLabels}
          onChange={(patch) => handleCosmeticCustomizationChange(customizeModal.item, customizeModal.entry, patch)}
          onClose={() => setCustomizeModal(null)}
        />
      )}
    </div>
  );
}

export default Marketplace;
