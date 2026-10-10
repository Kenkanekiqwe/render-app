import React, { useRef } from 'react';
import './TopBar.css';
import './BottomDock.css';
import { FaHome, FaSearch, FaMusic, FaHeart, FaCog, FaUsers, FaComments, FaStore } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import AvatarImage from './AvatarImage';
import { DockButton } from './BottomDock';

const CENTER_NAV = [
  { id: 'library', icon: FaMusic, labelKey: 'navLibrary' },
  { id: 'liked', icon: FaHeart, labelKey: 'navLiked' },
  { id: 'friends', icon: FaUsers, labelKey: 'navFriends' },
  { id: 'chat', icon: FaComments, labelKey: 'navChat' },
  { id: 'marketplace', icon: FaStore, labelKey: 'navMarketplace' },
  { id: 'settings', icon: FaCog, labelKey: 'settingsNav' },
];

function TopBar({
  currentView,
  setCurrentView,
  onOpenProfile,
  onOpenSettings,
  avatarUrl,
  searchQuery = '',
  onSearch,
  isSearching = false,
}) {
  const { t } = useLanguage();
  const searchRef = useRef(null);

  const goHome = () => setCurrentView('home');

  const focusSearch = () => {
    setCurrentView('search');
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className="top-bar-logo"
          onClick={goHome}
          aria-label={t('appName')}
        >
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="" />
        </button>
      </div>

      <div className="top-bar-center">
        <DockButton
          className="dock-nav-btn"
          label={t('navHome')}
          isActive={currentView === 'home'}
          onClick={goHome}
        >
          <FaHome />
        </DockButton>

        <label className={`top-bar-search${currentView === 'search' ? ' is-active' : ''}${isSearching ? ' is-searching' : ''}`}>
          <FaSearch className="top-bar-search-icon" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            placeholder={t('searchPlaceholder') || 'search'}
            onFocus={focusSearch}
            onChange={(e) => onSearch?.(e.target.value)}
            aria-label={t('navSearch')}
          />
        </label>

        {CENTER_NAV.map(({ id, icon: Icon, labelKey }) => (
          <DockButton
            key={id}
            className={id === 'settings' ? 'dock-settings-btn' : 'dock-nav-btn'}
            label={t(labelKey)}
            isActive={currentView === id}
            onClick={() => (id === 'settings' ? onOpenSettings() : setCurrentView(id))}
          >
            <Icon />
          </DockButton>
        ))}
      </div>

      <div className="top-bar-right">
        <DockButton
          className="dock-avatar-btn"
          label={t('profileNav')}
          isActive={currentView === 'profile'}
          pinIcon
          onClick={onOpenProfile}
        >
          <span className="dock-avatar-frame">
            <AvatarImage url={avatarUrl} fallback="R" className="dock-avatar-img" alt={t('profileNav')} />
          </span>
        </DockButton>
      </div>
    </header>
  );
}

export default TopBar;
