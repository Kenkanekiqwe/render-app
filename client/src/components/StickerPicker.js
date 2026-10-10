import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus, FaSmile, FaImages, FaTimes } from 'react-icons/fa';
import './StickerPicker.css';
import {
  addPackToCollection,
  addStickerToPack,
  createStickerPack,
  fetchMyStickerPacks,
  fetchStickerPack,
  fetchStickerPacks,
} from '../utils/stickers';

function StickerPicker({ open, onClose, onSendSticker, onSendGif, t }) {
  const [tab, setTab] = useState('mine');
  const [myPacks, setMyPacks] = useState([]);
  const [browsePacks, setBrowsePacks] = useState([]);
  const [activePack, setActivePack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newPackName, setNewPackName] = useState('');
  const [gifUrl, setGifUrl] = useState('');
  const fileRef = useRef(null);
  const [createPackId, setCreatePackId] = useState(null);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const packs = await fetchMyStickerPacks();
      setMyPacks(packs);
      if (!createPackId && packs[0]?.id) setCreatePackId(packs[0].id);
    } catch {
      setError(t('chatStickersLoadError'));
    } finally {
      setLoading(false);
    }
  }, [createPackId, t]);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const packs = await fetchStickerPacks();
      setBrowsePacks(packs);
    } catch {
      setError(t('chatStickersLoadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    setActivePack(null);
    if (tab === 'mine' || tab === 'create') loadMine();
    if (tab === 'browse') loadBrowse();
  }, [open, tab, loadMine, loadBrowse]);

  const openPack = async (packId) => {
    setLoading(true);
    setError('');
    try {
      const pack = await fetchStickerPack(packId);
      setActivePack(pack);
    } catch {
      setError(t('chatStickersLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddCollection = async (packId) => {
    try {
      await addPackToCollection(packId);
      await loadBrowse();
      if (tab === 'mine') await loadMine();
      if (activePack?.id === packId) {
        setActivePack((prev) => (prev ? { ...prev, isInCollection: true } : prev));
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('chatStickersAddError'));
    }
  };

  const handleCreatePack = async (e) => {
    e.preventDefault();
    const name = newPackName.trim();
    if (!name) return;
    try {
      const pack = await createStickerPack(name);
      setNewPackName('');
      setCreatePackId(pack.id);
      await loadMine();
      setTab('create');
    } catch (err) {
      setError(err?.response?.data?.error || t('chatStickersCreateError'));
    }
  };

  const handleUploadSticker = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !createPackId) return;
    try {
      await addStickerToPack(createPackId, { file });
      await loadMine();
      e.target.value = '';
    } catch (err) {
      setError(err?.response?.data?.error || t('chatStickersCreateError'));
    }
  };

  const handleSendGif = (e) => {
    e.preventDefault();
    const url = gifUrl.trim();
    if (!url) return;
    onSendGif?.(url);
    setGifUrl('');
    onClose?.();
  };

  if (!open) return null;

  const packs = tab === 'browse' ? browsePacks : myPacks;

  return createPortal(
    <div className="sticker-picker-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sticker-picker" role="dialog" aria-modal="true">
        <div className="sticker-picker__head">
          <FaSmile aria-hidden="true" />
          <span>{t('chatStickersTitle')}</span>
          <button type="button" className="sticker-picker__close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>

        <div className="sticker-picker__tabs">
          {['mine', 'browse', 'create', 'gif'].map((id) => (
            <button
              key={id}
              type="button"
              className={`sticker-picker__tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`chatStickersTab_${id}`)}
            </button>
          ))}
        </div>

        {error && <p className="sticker-picker__error">{error}</p>}
        {loading && <p className="sticker-picker__loading">{t('loadingTracks')}</p>}

        {!loading && tab === 'create' && (
          <div className="sticker-picker__create">
            <form onSubmit={handleCreatePack} className="sticker-picker__create-row">
              <input
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
                placeholder={t('chatStickersPackName')}
                maxLength={64}
              />
              <button type="submit" className="sticker-picker__btn">
                <FaPlus /> {t('chatStickersNewPack')}
              </button>
            </form>
            {myPacks.length > 0 && (
              <>
                <label className="sticker-picker__label">{t('chatStickersUploadTo')}</label>
                <select value={createPackId || ''} onChange={(e) => setCreatePackId(Number(e.target.value))}>
                  {myPacks.filter((p) => p.isOwned).map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.name}</option>
                  ))}
                </select>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={handleUploadSticker} />
                <button type="button" className="sticker-picker__btn" onClick={() => fileRef.current?.click()}>
                  {t('chatStickersUpload')}
                </button>
              </>
            )}
          </div>
        )}

        {!loading && tab === 'gif' && (
          <form className="sticker-picker__gif" onSubmit={handleSendGif}>
            <label>{t('chatGifUrl')}</label>
            <input
              value={gifUrl}
              onChange={(e) => setGifUrl(e.target.value)}
              placeholder="https://..."
            />
            <button type="submit" className="sticker-picker__btn">{t('chatGifSend')}</button>
          </form>
        )}

        {!loading && (tab === 'mine' || tab === 'browse') && !activePack && (
          <div className="sticker-picker__packs">
            {packs.length === 0 && <p className="sticker-picker__empty">{t('chatStickersEmpty')}</p>}
            {packs.map((pack) => (
              <button key={pack.id} type="button" className="sticker-pack-card" onClick={() => openPack(pack.id)}>
                {pack.coverUrl ? (
                  <img src={pack.coverUrl} alt="" />
                ) : (
                  <span className="sticker-pack-card__placeholder"><FaImages /></span>
                )}
                <span className="sticker-pack-card__name">{pack.name}</span>
                <span className="sticker-pack-card__count">{pack.stickerCount || 0}</span>
              </button>
            ))}
          </div>
        )}

        {!loading && activePack && (tab === 'mine' || tab === 'browse') && (
          <div className="sticker-picker__detail">
            <button type="button" className="sticker-picker__back" onClick={() => setActivePack(null)}>
              ← {activePack.name}
            </button>
            {!activePack.isInCollection && tab === 'browse' && (
              <button type="button" className="sticker-picker__btn" onClick={() => handleAddCollection(activePack.id)}>
                {t('chatStickersAddCollection')}
              </button>
            )}
            <div className="sticker-picker__grid">
              {(activePack.stickers || []).map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  className="sticker-item"
                  onClick={() => {
                    onSendSticker?.(sticker);
                    onClose?.();
                  }}
                  title={sticker.label || ''}
                >
                  <img src={sticker.imageUrl} alt="" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default StickerPicker;
