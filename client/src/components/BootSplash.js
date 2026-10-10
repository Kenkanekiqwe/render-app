import { useEffect } from 'react';
import './BootSplash.css';

const BOOT_MIN_MS = 1600;
const BOOT_FADE_MS = 480;
const bootStartedAt = (typeof window !== 'undefined' && window.__RENDER_BOOT_AT)
  ? window.__RENDER_BOOT_AT
  : Date.now();

function BootSplash({ ready = false, instant = false }) {
  useEffect(() => {
    if (!ready) return undefined;

    const el = document.getElementById('boot-splash');
    if (!el) return undefined;

    const elapsed = Date.now() - bootStartedAt;
    const wait = instant ? 0 : Math.max(320, BOOT_MIN_MS - elapsed);
    let fadeTimer;

    const showTimer = window.setTimeout(() => {
      el.classList.add('is-done');
      fadeTimer = window.setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, BOOT_FADE_MS);
    }, wait);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(fadeTimer);
    };
  }, [instant, ready]);

  return null;
}

export default BootSplash;
