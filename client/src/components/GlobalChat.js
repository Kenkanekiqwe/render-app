import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './GlobalChat.css';
import './StickerPicker.css';
import { FaPaperPlane, FaSmile, FaArrowLeft } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import { AdminPlaque } from './ProfileCosmetics';
import AvatarImage from './AvatarImage';
import StickerPicker from './StickerPicker';
import { sendChatMessage } from '../utils/stickers';

function formatTime(timestamp, locale) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

function messagesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const lastA = a[a.length - 1]?.id;
  const lastB = b[b.length - 1]?.id;
  return lastA === lastB && a[0]?.id === b[0]?.id;
}

function MessageContent({ msg }) {
  if (msg.type === 'sticker') {
    const src = msg.stickerImageUrl || msg.mediaUrl;
    if (!src) return null;
    return (
      <div className="chat-message-sticker">
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  if (msg.type === 'gif') {
    const src = msg.mediaUrl;
    if (!src) return null;
    return (
      <div className="chat-message-gif">
        <img src={src} alt="" draggable={false} />
        <span className="chat-message-gif__label">GIF</span>
      </div>
    );
  }
  return <div className="chat-message-text">{msg.text}</div>;
}

function GlobalChat({ active = true, currentUserId, currentUserAvatar, onOpenUserProfile }) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [stickersOpen, setStickersOpen] = useState(false);
  const [tab, setTab] = useState('global');
  const [friends, setFriends] = useState([]);
  const [dmUser, setDmUser] = useState(null);
  const listRef = useRef(null);
  const shouldStickRef = useRef(true);

  const localeMap = {
    russian: 'ru-RU',
    english: 'en-US',
    ukrainian: 'uk-UA',
  };

  const scrollToBottom = useCallback(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  const loadMessages = useCallback(async (silent = false) => {
    if (!active && silent) return;
    if (tab === 'dm' && !dmUser?.id) {
      if (!silent) setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = tab === 'dm'
        ? await axios.get(`/api/chat/dm?userId=${dmUser.id}&limit=40`)
        : await axios.get('/api/chat/messages?limit=40');
      const next = res.data || [];
      setMessages((prev) => (messagesEqual(prev, next) ? prev : next));
      if (shouldStickRef.current) {
        requestAnimationFrame(scrollToBottom);
      }
    } catch {
      if (!silent) setError(t('chatLoadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [active, tab, dmUser, scrollToBottom, t]);

  useEffect(() => {
    if (!active) return undefined;

    loadMessages();

    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      loadMessages(true);
    };

    const timer = setInterval(poll, 8000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadMessages(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, loadMessages]);

  useEffect(() => {
    if (tab !== 'dm' || !active) return undefined;
    let cancelled = false;
    axios.get('/api/friends').then((res) => {
      if (!cancelled) setFriends(res.data?.friends || []);
    }).catch(() => {
      if (!cancelled) setFriends([]);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, active]);

  useEffect(() => {
    setMessages([]);
    setError('');
    shouldStickRef.current = true;
  }, [tab, dmUser?.id]);

  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;
    shouldStickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const appendMessage = (message) => {
    setMessages((prev) => [...prev, message]);
    shouldStickRef.current = true;
    requestAnimationFrame(scrollToBottom);
  };

  const sendPayload = (payload) => sendChatMessage(
    payload,
    tab === 'dm' && dmUser?.id ? { dmUserId: dmUser.id } : undefined
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    if (tab === 'dm' && !dmUser?.id) return;

    setSending(true);
    setError('');
    try {
      const res = await sendPayload({ type: 'text', text: value });
      setText('');
      appendMessage(res);
    } catch (err) {
      setError(err?.response?.data?.error || t('chatSendError'));
    } finally {
      setSending(false);
    }
  };

  const handleSendSticker = async (sticker) => {
    if (!sticker?.id || sending) return;
    if (tab === 'dm' && !dmUser?.id) return;
    setSending(true);
    setError('');
    try {
      const res = await sendPayload({ type: 'sticker', stickerId: sticker.id });
      appendMessage(res);
    } catch (err) {
      setError(err?.response?.data?.error || t('chatSendError'));
    } finally {
      setSending(false);
    }
  };

  const handleSendGif = async (mediaUrl) => {
    if (!mediaUrl || sending) return;
    if (tab === 'dm' && !dmUser?.id) return;
    setSending(true);
    setError('');
    try {
      const res = await sendPayload({ type: 'gif', mediaUrl });
      appendMessage(res);
    } catch (err) {
      setError(err?.response?.data?.error || t('chatSendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h1>{tab === 'dm' ? t('chatDmTitle') : t('chatTitle')}</h1>
        <p>{tab === 'dm' ? t('chatDmDesc') : t('chatDesc')}</p>
        <div className="chat-tabs">
          <button
            type="button"
            className={`chat-tab${tab === 'global' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('global');
              setDmUser(null);
            }}
          >
            {t('chatTabGlobal')}
          </button>
          <button
            type="button"
            className={`chat-tab${tab === 'dm' ? ' is-active' : ''}`}
            onClick={() => setTab('dm')}
          >
            {t('chatTabDm')}
          </button>
        </div>
      </div>

      <div className="chat-panel liquid-glass">
        {tab === 'dm' && !dmUser && (
          <div className="chat-dm-list">
            {friends.length ? friends.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chat-dm-friend"
                onClick={() => setDmUser(item.user)}
              >
                <AvatarImage
                  url={item.user?.avatarUrl}
                  fallback={item.user?.username?.[0] || '?'}
                />
                <span>{item.user?.displayName || item.user?.username}</span>
              </button>
            )) : (
              <p className="chat-empty">{t('chatDmEmptyFriends')}</p>
            )}
          </div>
        )}

        {(tab === 'global' || dmUser) && (
          <>
        {tab === 'dm' && dmUser && (
          <div className="chat-dm-head">
            <button type="button" onClick={() => setDmUser(null)} aria-label={t('chatDmBack')}>
              <FaArrowLeft />
            </button>
            <button type="button" className="chat-dm-name" onClick={() => onOpenUserProfile?.(dmUser.id)}>
              {dmUser.displayName || dmUser.username}
            </button>
          </div>
        )}
        <div ref={listRef} className="chat-messages hide-scrollbar" onScroll={handleScroll}>
          {loading ? (
            <p className="chat-empty">{t('loadingTracks')}</p>
          ) : messages.length ? (
            messages.map((msg) => {
              const mine = msg.user?.id === currentUserId;
              const avatarUrl = mine ? (currentUserAvatar || msg.user?.avatarUrl) : msg.user?.avatarUrl;
              return (
                <div key={msg.id} className={`chat-message${mine ? ' chat-message--mine' : ''}`}>
                  <span className="chat-message-avatar">
                    <AvatarImage
                      url={avatarUrl}
                      fallback={msg.user?.username?.[0] || '?'}
                    />
                  </span>
                  <div className="chat-message-body">
                    <div className="chat-message-meta">
                      <button
                        type="button"
                        className="chat-message-author"
                        onClick={() => onOpenUserProfile?.(msg.user?.id)}
                      >
                        {msg.user?.displayName || msg.user?.username}
                      </button>
                      <AdminPlaque isAdmin={msg.user?.isAdmin} />
                      <span>{formatTime(msg.createdAt, localeMap[language] || 'en-US')}</span>
                    </div>
                    <MessageContent msg={msg} />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="chat-empty">{t('chatEmpty')}</p>
          )}
        </div>

        {error && <p className="chat-error">{error}</p>}

        <div className="chat-toolbar">
          <button
            type="button"
            className="chat-tool-btn"
            onClick={() => setStickersOpen(true)}
            aria-label={t('chatStickersTitle')}
          >
            <FaSmile />
          </button>
        </div>

        <form className="chat-input-row" onSubmit={handleSubmit}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('chatPlaceholder')}
            maxLength={2000}
          />
          <button type="submit" className="chat-send-btn" disabled={sending || !text.trim()}>
            <FaPaperPlane />
          </button>
        </form>
          </>
        )}
      </div>

      <StickerPicker
        open={stickersOpen}
        onClose={() => setStickersOpen(false)}
        onSendSticker={handleSendSticker}
        onSendGif={handleSendGif}
        t={t}
      />
    </div>
  );
}

export default GlobalChat;
