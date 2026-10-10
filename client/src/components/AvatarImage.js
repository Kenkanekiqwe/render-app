import React, { useState, useEffect } from 'react';
import './AvatarImage.css';

function AvatarImage({ url, fallback = 'R', className = '', alt = 'Avatar' }) {
  const [failed, setFailed] = useState(false);
  const classes = ['avatar-image', className].filter(Boolean).join(' ');

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url?.trim() || failed) {
    return (
      <span className={`avatar-fallback ${classes}`.trim()} aria-hidden="true">
        {fallback}
      </span>
    );
  }

  return (
    <img
      src={url.trim()}
      alt={alt}
      className={classes}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export default AvatarImage;
