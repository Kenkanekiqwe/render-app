import React, { useEffect, useRef } from 'react';

function applyBannerRatio(img) {
  const wrap = img?.parentElement;
  if (!wrap) return;
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return;
  wrap.style.setProperty('--banner-ratio', `${width} / ${height}`);
}

function BannerImage({ url, className = 'profile-banner-img', alt = '' }) {
  const imgRef = useRef(null);
  const src = url?.trim() || '';

  useEffect(() => {
    const img = imgRef.current;
    const wrap = img?.parentElement;
    if (!wrap) return undefined;

    if (img?.complete && img.naturalWidth) {
      applyBannerRatio(img);
    }

    return () => {
      wrap.style.removeProperty('--banner-ratio');
    };
  }, [src]);

  if (!src) return null;

  return (
    <img
      ref={imgRef}
      className={className}
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      loading="eager"
      draggable={false}
      onLoad={(event) => applyBannerRatio(event.currentTarget)}
    />
  );
}

export default BannerImage;
