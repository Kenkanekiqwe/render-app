import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import './Friends.css';
import { FaUserPlus, FaCheck, FaTimes, FaSearch, FaPlay, FaPhone, FaVideo } from 'react-icons/fa';
import { useCallOptional } from '../context/CallContext';
import { useLanguage } from '../context/LanguageContext';
import { AdminPlaque } from './ProfileCosmetics';
import AvatarImage from './AvatarImage';
import StaticIdBadge from './StaticIdBadge';

function Friends({ onOpenUserProfile, playTrack }) {
  const { t } = useLanguage();
  const call = useCallOptional();
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadFriends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/friends');
      setFriends(res.data.friends || []);
      setIncoming(res.data.incoming || []);
      setOutgoing(res.data.outgoing || []);
    } catch {
      setActionError(t('friendsLoadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get(`/api/friends/search?q=${encodeURIComponent(query.trim())}`);
        setSearchResults(res.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleRequest = async (username) => {
    setActionError('');
    try {
      await axios.post('/api/friends/request', { username });
      setQuery('');
      setSearchResults([]);
      await loadFriends();
    } catch (error) {
      setActionError(error?.response?.data?.error || t('friendsRequestError'));
    }
  };

  const handleAccept = async (friendshipId) => {
    setActionError('');
    try {
      await axios.post('/api/friends/accept', { friendshipId });
      await loadFriends();
    } catch (error) {
      setActionError(error?.response?.data?.error || t('friendsAcceptError'));
    }
  };

  const handleRemove = async (friendshipId) => {
    setActionError('');
    try {
      await axios.delete(`/api/friends/${friendshipId}`);
      await loadFriends();
    } catch (error) {
      setActionError(error?.response?.data?.error || t('friendsRemoveError'));
    }
  };

  const renderUserCard = (item, actions, { callable = false } = {}) => (
    <div key={item.id} className="friends-card">
      <button
        type="button"
        className="friends-card-user friends-card-user-btn"
        onClick={() => onOpenUserProfile?.(item.user?.id)}
      >
        <span className="friends-card-avatar">
          <AvatarImage
            url={item.user?.avatarUrl}
            fallback={item.user?.username?.[0] || '?'}
          />
        </span>
        <div className="friends-card-info">
          <div className="friends-card-name">
            <strong>{item.user?.displayName || item.user?.username}</strong>
            <AdminPlaque isAdmin={item.user?.isAdmin} />
            <StaticIdBadge staticId={item.user?.staticId} />
          </div>
          <span className="friends-card-username">@{item.user?.username}</span>
          {item.nowPlaying?.track && (
            <span className="friends-now-playing">
              {item.nowPlaying.track.title}
              {item.nowPlaying.track.artist ? ` — ${item.nowPlaying.track.artist}` : ''}
            </span>
          )}
        </div>
      </button>
      <div className="friends-card-actions">
        {callable && call && item.user?.id && (
          <>
            <button
              type="button"
              className="friends-btn friends-btn-call"
              title={t('callVoice')}
              disabled={call.phase !== 'idle'}
              onClick={() => call.startCall(item.user, { video: false })}
            >
              <FaPhone />
            </button>
            <button
              type="button"
              className="friends-btn friends-btn-call"
              title={t('callVideo')}
              disabled={call.phase !== 'idle'}
              onClick={() => call.startCall(item.user, { video: true })}
            >
              <FaVideo />
            </button>
          </>
        )}
        {item.nowPlaying?.track && (
          <button
            type="button"
            className="friends-btn friends-btn-listen"
            title={t('friendsListenAlong')}
            onClick={() => playTrack?.(item.nowPlaying.track)}
          >
            <FaPlay />
          </button>
        )}
        {actions}
      </div>
    </div>
  );

  return (
    <div className="friends-page">
      <div className="friends-header">
        <h1>{t('friendsTitle')}</h1>
        <p>{t('friendsDesc')}</p>
      </div>

      <div className="friends-search">
        <FaSearch className="friends-search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('friendsSearchPlaceholder')}
        />
      </div>

      {actionError && <p className="friends-error">{actionError}</p>}

      {query.trim().length >= 2 && (
        <section className="friends-section">
          <h2>{t('friendsSearchResults')}</h2>
          {searching ? (
            <p className="friends-empty">{t('loadingTracks')}</p>
          ) : searchResults.length ? (
            searchResults.map((user) => (
              <div key={user.id} className="friends-card">
                <button
                  type="button"
                  className="friends-card-user friends-card-user-btn"
                  onClick={() => onOpenUserProfile?.(user.id)}
                >
                  <span className="friends-card-avatar">
                    <AvatarImage
                      url={user.avatarUrl}
                      fallback={user.username?.[0] || '?'}
                    />
                  </span>
                  <div className="friends-card-info">
                    <div className="friends-card-name">
                      <strong>{user.displayName || user.username}</strong>
                      <AdminPlaque isAdmin={user.isAdmin} />
                      <StaticIdBadge staticId={user.staticId} />
                    </div>
                    <span className="friends-card-username">@{user.username}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="friends-btn friends-btn-primary"
                  onClick={() => handleRequest(user.username)}
                >
                  <FaUserPlus /> {t('friendsAdd')}
                </button>
              </div>
            ))
          ) : (
            <p className="friends-empty">{t('noResults')}</p>
          )}
        </section>
      )}

      {loading ? (
        <p className="friends-empty">{t('loadingTracks')}</p>
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="friends-section">
              <h2>{t('friendsIncoming')}</h2>
              {incoming.map((item) =>
                renderUserCard(
                  item,
                  <div className="friends-card-actions">
                    <button
                      type="button"
                      className="friends-btn friends-btn-primary"
                      onClick={() => handleAccept(item.id)}
                    >
                      <FaCheck /> {t('friendsAccept')}
                    </button>
                    <button
                      type="button"
                      className="friends-btn friends-btn-ghost"
                      onClick={() => handleRemove(item.id)}
                    >
                      <FaTimes /> {t('friendsDecline')}
                    </button>
                  </div>
                )
              )}
            </section>
          )}

          {outgoing.length > 0 && (
            <section className="friends-section">
              <h2>{t('friendsOutgoing')}</h2>
              {outgoing.map((item) =>
                renderUserCard(
                  item,
                  <button
                    type="button"
                    className="friends-btn friends-btn-ghost"
                    onClick={() => handleRemove(item.id)}
                  >
                    <FaTimes /> {t('friendsCancel')}
                  </button>
                )
              )}
            </section>
          )}

          <section className="friends-section">
            <h2>{t('friendsList')}</h2>
            {friends.length ? (
              friends.map((item) =>
                renderUserCard(
                  item,
                  <button
                    type="button"
                    className="friends-btn friends-btn-ghost"
                    onClick={() => handleRemove(item.id)}
                  >
                    <FaTimes /> {t('friendsRemove')}
                  </button>,
                  { callable: true }
                )
              )
            ) : (
              <p className="friends-empty">{t('friendsEmpty')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default Friends;
