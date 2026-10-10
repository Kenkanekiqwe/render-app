import React, { memo } from 'react';

function LyricLine({ text, state, distance = 0, lineRef }) {
  const depth = state === 'active' ? 0 : Math.min(3, Math.max(1, Number(distance) || 1));

  return (
    <p
      ref={lineRef}
      className={`now-playing-lyric now-playing-lyric--${state} now-playing-lyric--d${depth}`}
    >
      <span className="now-playing-lyric-text">{text}</span>
    </p>
  );
}

export default memo(LyricLine);
