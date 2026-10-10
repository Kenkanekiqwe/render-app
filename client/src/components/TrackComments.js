import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { FaPaperPlane } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import AvatarImage from './AvatarImage';

function formatStamp(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

function TrackComments({ trackId }) {
  const { t } = useLanguage();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!trackId) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`/api/tracks/${trackId}/comments`);
      setComments(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t('commentsLoadError'));
    } finally {
      setLoading(false);
    }
  }, [trackId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await axios.post(`/api/tracks/${trackId}/comments`, { text: value });
      setText('');
      setComments((prev) => [...prev, res.data]);
    } catch (err) {
      setError(err?.response?.data?.error || t('commentsSendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="track-comments">
      <strong className="track-comments-title">{t('commentsTitle')}</strong>
      <div className="track-comments-list">
        {loading ? (
          <p className="track-comments-empty">{t('loadingTracks')}</p>
        ) : comments.length ? (
          comments.map((item) => (
            <div key={item.id} className="track-comments-item">
              <AvatarImage
                url={item.user?.avatarUrl}
                fallback={item.user?.username?.[0] || '?'}
              />
              <div>
                <div className="track-comments-meta">
                  <span>{item.user?.displayName || item.user?.username}</span>
                  <time>{formatStamp(item.createdAt)}</time>
                </div>
                <p>{item.text}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="track-comments-empty">{t('commentsEmpty')}</p>
        )}
      </div>
      {error ? <p className="track-comments-error">{error}</p> : null}
      <form className="track-comments-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          maxLength={400}
          placeholder={t('commentsPlaceholder')}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={sending || !text.trim()} aria-label={t('commentsSend')}>
          <FaPaperPlane />
        </button>
      </form>
    </div>
  );
}

export default TrackComments;
