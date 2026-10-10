import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import './Workshop.css';
import { FaPlus, FaTrash, FaCheck } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import AvatarImage from './AvatarImage';

const TYPES = ['background', 'banner', 'avatar'];

function Workshop({ currentUserId, onApplyItem }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    type: 'background',
    url: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const query = filter === 'all' ? '' : `?type=${filter}`;
      const res = await axios.get(`/api/workshop${query}`);
      setItems(res.data || []);
    } catch {
      setError(t('workshopLoadError'));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handlePublish = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await axios.post('/api/workshop', form);
      setForm({ title: '', type: 'background', url: '', description: '' });
      await loadItems();
    } catch (err) {
      setError(err?.response?.data?.error || t('workshopPublishError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApply = async (item) => {
    setError('');
    try {
      await axios.post(`/api/workshop/${item.id}/apply`);
      onApplyItem?.(item);
      await loadItems();
    } catch (err) {
      setError(err?.response?.data?.error || t('workshopApplyError'));
    }
  };

  const handleDelete = async (itemId) => {
    setError('');
    try {
      await axios.delete(`/api/workshop/${itemId}`);
      await loadItems();
    } catch (err) {
      setError(err?.response?.data?.error || t('workshopDeleteError'));
    }
  };

  return (
    <div className="workshop-page">
      <header className="workshop-header">
        <h1>{t('workshopTitle')}</h1>
        <p>{t('workshopDesc')}</p>
      </header>

      <form className="workshop-form" onSubmit={handlePublish}>
        <h2>{t('workshopPublish')}</h2>
        <div className="workshop-form-grid">
          <input
            type="text"
            placeholder={t('workshopNamePlaceholder')}
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            maxLength={120}
            required
          />
          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
            aria-label={t('workshopPublish')}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`workshopType_${type}`)}
              </option>
            ))}
          </select>
          <input
            type="url"
            className="workshop-form-wide"
            placeholder={t('workshopUrlPlaceholder')}
            value={form.url}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            required
          />
          <input
            type="text"
            className="workshop-form-wide"
            placeholder={t('workshopDescPlaceholder')}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            maxLength={500}
          />
        </div>
        <div className="workshop-form-actions">
          <button type="submit" className="workshop-btn workshop-btn-primary" disabled={submitting}>
            <FaPlus /> {t('workshopPublishBtn')}
          </button>
        </div>
      </form>

      <div className="workshop-filters" role="group" aria-label={t('workshopFilterAll')}>
        {['all', ...TYPES].map((type) => (
          <button
            key={type}
            type="button"
            className={`workshop-filter${filter === type ? ' active' : ''}`}
            onClick={() => setFilter(type)}
          >
            {type === 'all' ? t('workshopFilterAll') : t(`workshopType_${type}`)}
          </button>
        ))}
      </div>

      {error && <p className="workshop-error" role="alert">{error}</p>}

      {loading ? (
        <p className="workshop-loading">{t('loadingTracks')}</p>
      ) : items.length ? (
        <div className="workshop-grid">
          {items.map((item) => (
            <article key={item.id} className="workshop-card">
              <div
                className={`workshop-preview workshop-preview--${item.type}`}
                style={{ backgroundImage: `url("${item.url}")` }}
                role="img"
                aria-label={item.title}
              />
              <div className="workshop-card-body">
                <div className="workshop-card-head">
                  <h3 title={item.title}>{item.title}</h3>
                  <span className="workshop-type">{t(`workshopType_${item.type}`)}</span>
                </div>
                {item.description && <p className="workshop-card-desc">{item.description}</p>}
                <div className="workshop-author">
                  <AvatarImage
                    url={item.author?.avatarUrl}
                    fallback={item.author?.username?.[0] || '?'}
                  />
                  <span>@{item.author?.username}</span>
                  <span className="workshop-uses">
                    {item.usesCount} {t('workshopUses')}
                  </span>
                </div>
                <div className="workshop-card-actions">
                  <button
                    type="button"
                    className="workshop-btn workshop-btn-primary"
                    onClick={() => handleApply(item)}
                  >
                    <FaCheck /> {t('workshopApply')}
                  </button>
                  {item.author?.id === currentUserId && (
                    <button
                      type="button"
                      className="workshop-btn workshop-btn-ghost"
                      onClick={() => handleDelete(item.id)}
                    >
                      <FaTrash /> {t('workshopDelete')}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="workshop-empty">{t('workshopEmpty')}</p>
      )}
    </div>
  );
}

export default Workshop;
