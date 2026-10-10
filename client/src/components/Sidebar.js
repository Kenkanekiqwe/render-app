import React from 'react';
import './Sidebar.css';
import { FaHome, FaSearch, FaMusic, FaHeart, FaPlus } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';

function Sidebar({ playlists, currentView, setCurrentView }) {
  const { t } = useLanguage();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo" onClick={() => setCurrentView('home')}>
        <FaMusic className="logo-icon" />
        <h1>{t('appName')}</h1>
      </div>

      <nav className="sidebar-nav" aria-label={t('music')}>
        <div
          className={`nav-item ${currentView === 'home' ? 'active' : ''}`}
          onClick={() => setCurrentView('home')}
        >
          <FaHome />
          <span>{t('home')}</span>
        </div>
        <div
          className={`nav-item ${currentView === 'search' ? 'active' : ''}`}
          onClick={() => setCurrentView('search')}
        >
          <FaSearch />
          <span>{t('search')}</span>
        </div>
        <div
          className={`nav-item ${currentView === 'library' ? 'active' : ''}`}
          onClick={() => setCurrentView('library')}
        >
          <FaMusic />
          <span>{t('library')}</span>
        </div>
        <div
          className={`nav-item ${currentView === 'liked' ? 'active' : ''}`}
          onClick={() => setCurrentView('liked')}
        >
          <FaHeart />
          <span>{t('liked')}</span>
        </div>
      </nav>

      <div className="sidebar-playlists">
        <div className="playlists-header">
          <h3>{t('playlists')}</h3>
          <FaPlus className="add-icon" />
        </div>
        <div className="playlists-list">
          {(playlists || []).map((playlist) => (
            <div
              key={playlist.id}
              className="playlist-item"
              onClick={() => setCurrentView(`playlist-${playlist.id}`)}
            >
              {playlist.name}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
