import React, { useCallback, useEffect, useState } from 'react';
import './TitleBar.css';
import { FaDiscord, FaTelegramPlane } from 'react-icons/fa';
import { openExternalUrl } from '../utils/openExternal';
import {
  closeWindow,
  isDesktopApp,
  isWindowMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
  waitForAppWindow,
} from '../utils/tauri';

const SOCIAL_LINKS = [
  { id: 'discord', href: 'https://discord.gg/Mc5CEEHrQP', icon: FaDiscord, label: 'Discord' },
  { id: 'telegram', href: 'https://t.me/rendermusic', icon: FaTelegramPlane, label: 'Telegram' },
];

function TitleBar() {
  const [desktop] = useState(() => isDesktopApp());
  const [ready, setReady] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return undefined;

    document.body.classList.add('render-desktop');
    let unlisten;

    waitForAppWindow().then((win) => {
      if (!win) return;
      setReady(true);
      win.isMaximized?.().then(setMaximized).catch(() => {});

      if (typeof win.onResized === 'function') {
        win
          .onResized(() => {
            win.isMaximized?.().then(setMaximized).catch(() => {});
          })
          .then((fn) => {
            unlisten = fn;
          })
          .catch(() => {});
      }
    });

    return () => {
      document.body.classList.remove('render-desktop');
      if (typeof unlisten === 'function') unlisten();
    };
  }, [desktop]);

  const handleMinimize = useCallback(() => {
    minimizeWindow().catch(() => {});
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      await toggleMaximizeWindow();
      setMaximized(await isWindowMaximized());
    } catch {
      // ignore
    }
  }, []);

  const handleClose = useCallback(() => {
    closeWindow().catch(() => {});
  }, []);

  if (!desktop) return null;

  return (
    <div className="render-titlebar">
      <div className="render-titlebar__brand" data-tauri-drag-region>
        <img
          src={`${process.env.PUBLIC_URL}/logo.png`}
          alt=""
          className="render-titlebar__logo"
          draggable={false}
        />
        <span className="render-titlebar__title" data-tauri-drag-region>
          Render
        </span>
      </div>

      <div className="render-titlebar__social">
        {SOCIAL_LINKS.map(({ id, href, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            className={`render-titlebar__social-btn render-titlebar__social-btn--${id}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openExternalUrl(href);
            }}
            aria-label={label}
            title={label}
          >
            <Icon aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="render-titlebar__controls">
        <button
          type="button"
          className="render-titlebar__btn"
          onClick={handleMinimize}
          disabled={!ready}
          aria-label="Свернуть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="render-titlebar__btn"
          onClick={handleToggleMaximize}
          disabled={!ready}
          aria-label={maximized ? 'Восстановить' : 'Развернуть'}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1.2" y="2.8" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" />
              <path d="M3.4 2.8V1.8a1 1 0 0 1 1-1h3.8a1 1 0 0 1 1 1v3.8a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="render-titlebar__btn render-titlebar__btn--close"
          onClick={handleClose}
          disabled={!ready}
          aria-label="Закрыть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
