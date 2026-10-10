import React, { useRef, useCallback } from 'react';
import './BottomDock.css';
import { FaHome, FaSearch, FaMusic, FaHeart, FaCog, FaUsers, FaComments, FaStore } from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import AvatarImage from './AvatarImage';

const NAV_ITEMS = [
  { id: 'home', icon: FaHome, labelKey: 'navHome' },
  { id: 'search', icon: FaSearch, labelKey: 'navSearch' },
  { id: 'library', icon: FaMusic, labelKey: 'navLibrary' },
  { id: 'liked', icon: FaHeart, labelKey: 'navLiked' },
  { id: 'friends', icon: FaUsers, labelKey: 'navFriends' },
  { id: 'chat', icon: FaComments, labelKey: 'navChat' },
  { id: 'marketplace', icon: FaStore, labelKey: 'navMarketplace' },
];

const SLIDE_MS = 720;
const SLIDE_EASE = 'cubic-bezier(0.22, 0.9, 0.18, 1)';

export function DockButton({ className, label, onClick, isActive, expand = true, pinIcon = false, children }) {
  const slideRef = useRef(null);
  const animRef = useRef(null);
  const hoverRef = useRef(false);

  const getSizes = useCallback(() => {
    const slide = slideRef.current;
    if (!slide) return null;

    const labelEl = slide.querySelector('.dock-btn-label-inner');
    if (!labelEl) return null;

    const host = slide.closest('.dock-btn');
    const icon = slide.querySelector('.dock-btn-icon');
    const token = host ? parseFloat(getComputedStyle(host).getPropertyValue('--dock-size')) : NaN;
    const closed = pinIcon
      ? (Number.isFinite(token) ? token : host?.offsetWidth || 42)
      : (icon?.offsetWidth || 36);
    const labelWidth = labelEl.scrollWidth || Math.ceil((labelEl.textContent || '').length * 8);
    const open = closed + labelWidth + (pinIcon ? 12 : 6);

    return { slide, closed, open };
  }, [pinIcon]);

  const resetSlide = useCallback((slide) => {
    slide.getAnimations().forEach((anim) => anim.cancel());
    slide.classList.remove('is-open');
    slide.style.width = '';
  }, []);

  const openSlide = useCallback(() => {
    if (!expand) return;
    if (window.matchMedia('(max-width: 520px)').matches) return;

    const sizes = getSizes();
    if (!sizes) return;

    const { slide, closed, open } = sizes;
    if (slide.classList.contains('is-open') && slide.offsetWidth >= open - 1) return;

    animRef.current?.cancel();
    slide.classList.add('is-open');
    slide.style.width = `${closed}px`;

    animRef.current = slide.animate(
      [{ width: `${closed}px` }, { width: `${open}px` }],
      { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'forwards' }
    );

    animRef.current.onfinish = () => {
      if (hoverRef.current && slide.classList.contains('is-open')) {
        slide.style.width = `${open}px`;
      } else {
        resetSlide(slide);
      }
    };
  }, [expand, getSizes, resetSlide]);

  const closeSlide = useCallback(() => {
    const slide = slideRef.current;
    if (!slide || !slide.classList.contains('is-open')) return;

    const sizes = getSizes();
    if (!sizes) {
      resetSlide(slide);
      return;
    }

    const { closed } = sizes;
    const current = slide.offsetWidth;

    animRef.current?.cancel();
    slide.classList.remove('is-open');

    animRef.current = slide.animate(
      [{ width: `${current}px` }, { width: `${closed}px` }],
      { duration: SLIDE_MS * 0.85, easing: SLIDE_EASE, fill: 'forwards' }
    );

    animRef.current.onfinish = () => {
      resetSlide(slide);
    };
  }, [getSizes, resetSlide]);

  const handlePointerEnter = () => {
    hoverRef.current = true;
    openSlide();
  };

  const handlePointerLeave = () => {
    hoverRef.current = false;
    closeSlide();
  };

  return (
    <button
      type="button"
      className={`dock-btn ${className}${isActive ? ' active' : ''}${expand ? '' : ' is-static'}${pinIcon ? ' has-pinned-icon' : ''}`}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
    >
      {pinIcon ? (
        <>
          <span className="dock-btn-icon dock-btn-icon--pinned">{children}</span>
          <span ref={slideRef} className="dock-btn-slide">
            <span className="dock-btn-label">
              <span className="dock-btn-label-inner">{label}</span>
            </span>
          </span>
        </>
      ) : (
        <span ref={slideRef} className="dock-btn-slide">
          <span className="dock-btn-icon">{children}</span>
          <span className="dock-btn-label">
            <span className="dock-btn-label-inner">{label}</span>
          </span>
        </span>
      )}
    </button>
  );
}

function BottomDock({
  currentView,
  setCurrentView,
  onOpenProfile,
  onOpenSettings,
  avatarUrl,
}) {
  const { t } = useLanguage();

  return (
    <div className="bottom-dock liquid-glass">
      <nav className="dock-nav" aria-label="Navigation">
        {NAV_ITEMS.map(({ id, icon: Icon, labelKey }) => (
          <DockButton
            key={id}
            className="dock-nav-btn"
            label={t(labelKey)}
            isActive={currentView === id}
            onClick={() => setCurrentView(id)}
          >
            <Icon />
          </DockButton>
        ))}
      </nav>

      <div className="dock-divider" aria-hidden="true" />

      <div className="dock-user">
        <DockButton
          className="dock-settings-btn"
          label={t('settingsNav')}
          isActive={currentView === 'settings'}
          onClick={onOpenSettings}
        >
          <FaCog />
        </DockButton>
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
    </div>
  );
}

export default BottomDock;
