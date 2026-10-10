export function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = [];

  lrcText.split('\n').forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const tagRegex = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
    let match;
    let textStart = 0;

    while ((match = tagRegex.exec(trimmed)) !== null) {
      textStart = tagRegex.lastIndex;
    }

    const text = trimmed.slice(textStart).trim();
    if (!text) return;

    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      lines.push({ time: minutes * 60 + seconds, text });
    }
  });

  return lines.sort((a, b) => a.time - b.time);
}

export function getActiveLineIndex(lines, currentTime) {
  if (!lines?.length) return -1;
  if (currentTime < lines[0].time) return -1;

  let active = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTime) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export function getLineEndTime(lines, index, trackDuration) {
  const start = lines[index]?.time ?? 0;
  if (index + 1 < lines.length) {
    return Math.max(start + 0.6, lines[index + 1].time);
  }
  if (Number.isFinite(trackDuration) && trackDuration > start) {
    return trackDuration;
  }
  return start + 4;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MIN_REVEAL_SECONDS_PER_CHAR = 0.04;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Infer singing speed from other LRC lines (skips long instrumental gaps). */
export function inferCharsPerSecond(lines, index) {
  if (!lines?.length) return 3.8;

  const samples = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]?.text || '';
    const chars = [...text].length;
    if (chars === 0) continue;

    const start = lines[i].time;
    const end = i + 1 < lines.length ? lines[i + 1].time : start + chars / 3.8;
    const gap = end - start;
    if (gap < 0.35 || gap > 10) continue;

    const baseline = chars / 3.8;
    if (gap > baseline * 1.65) continue;

    samples.push(chars / gap);
  }

  const local = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const i = index + offset;
    if (i < 0 || i >= lines.length || i === index) continue;
    const text = lines[i]?.text || '';
    const chars = [...text].length;
    if (chars === 0) continue;
    const start = lines[i].time;
    const end = i + 1 < lines.length ? lines[i + 1].time : start + chars / 3.8;
    const gap = end - start;
    if (gap < 0.35 || gap > 10) continue;
    if (gap > (chars / 3.8) * 1.65) continue;
    local.push(chars / gap);
  }

  const pick = median(local) ?? median(samples);
  if (!pick) return 3.8;
  return clamp(pick, 2.6, 8.5);
}

export function createLyricsSyncState() {
  return {
    speedMultiplier: 1,
    vocalFill: 0.93,
  };
}

export function getLineRevealMapping(text, lineStart, lineEnd, lines, index, syncState = null) {
  const gap = Math.max(0, lineEnd - lineStart);
  const charCount = text ? [...text].length : 0;
  const speed = syncState?.speedMultiplier ?? 1;
  const vocalFill = syncState?.vocalFill ?? 0.93;

  if (charCount === 0) {
    return {
      revealDuration: Math.min(gap, 0.4) || 0.4,
      gap,
      isInstrumental: false,
      speed,
      vocalFill,
    };
  }

  const charsPerSecond = inferCharsPerSecond(lines, index);
  const estimatedVocal = charCount / charsPerSecond;
  const isInstrumental = gap > Math.max(estimatedVocal * 1.45, 2.2);

  let baseDuration;
  if (isInstrumental) {
    baseDuration = Math.max(0.3, estimatedVocal * 0.98);
  } else {
    baseDuration = Math.max(0.32, gap * vocalFill);
  }

  const minimumReadableDuration = charCount * MIN_REVEAL_SECONDS_PER_CHAR;
  let revealDuration = Math.max(
    minimumReadableDuration,
    baseDuration / clamp(speed, 0.72, 1.42)
  );

  // Never let the character stream outlast the line's own window, otherwise
  // letters "stall" and then snap in groups of 2-3 at the very end.
  if (!isInstrumental && gap > 0) {
    revealDuration = Math.min(revealDuration, gap);
  }

  return {
    revealDuration,
    gap,
    isInstrumental,
    speed,
    vocalFill,
  };
}

/** @deprecated Use getLineRevealMapping */
export function getLineRevealDuration(text, lineStart, lineEnd, lines, index, syncState = null) {
  return getLineRevealMapping(text, lineStart, lineEnd, lines, index, syncState).revealDuration;
}

function getAdaptiveWarp(elapsed, gap, revealDuration, isInstrumental) {
  if (isInstrumental || gap <= 0 || revealDuration <= 0) return elapsed;

  const targetProgress = clamp(elapsed / gap, 0, 1);
  const scheduleProgress = clamp(elapsed / revealDuration, 0, 1);
  const drift = targetProgress - scheduleProgress;
  const gain = 0.32 + clamp(Math.abs(drift) * 5, 0, 1) * 0.28;

  return clamp(elapsed * (1 + drift * gain), 0, revealDuration);
}

export function getCharRevealProgress(charIndex, totalChars, currentTime, lineStart, mapping) {
  if (totalChars <= 0) return 1;

  const revealDuration = typeof mapping === 'number' ? mapping : mapping.revealDuration;
  const gap = typeof mapping === 'number' ? mapping : mapping.gap;
  const isInstrumental = typeof mapping === 'number' ? false : mapping.isInstrumental;

  const elapsed = Math.max(0, currentTime - lineStart);
  if (isInstrumental && elapsed >= revealDuration) return 1;
  if (!isInstrumental && elapsed >= gap) return 1;

  const warpedElapsed = getAdaptiveWarp(elapsed, gap, revealDuration, isInstrumental);
  if (warpedElapsed >= revealDuration) return 1;

  const charStart = (charIndex / totalChars) * revealDuration;
  const charEnd = ((charIndex + 1) / totalChars) * revealDuration;

  if (warpedElapsed <= charStart) return 0;
  if (warpedElapsed >= charEnd) return 1;

  const t = (warpedElapsed - charStart) / (charEnd - charStart);
  return t * t * (3 - 2 * t);
}

export function getLineCompletionProgress(totalChars, currentTime, lineStart, mapping) {
  if (totalChars <= 0) return 1;

  let sum = 0;
  for (let i = 0; i < totalChars; i += 1) {
    sum += getCharRevealProgress(i, totalChars, currentTime, lineStart, mapping);
  }
  return sum / totalChars;
}

/** Adjust speed/fill after a line ends based on how well reveal matched the LRC window. */
export function updateLyricsSyncOnLineChange(state, lines, prevIndex, switchTime, trackDuration) {
  if (prevIndex < 0 || !lines[prevIndex]) return state;

  const text = lines[prevIndex].text || '';
  const charCount = [...text].length;
  if (charCount === 0) return state;

  const lineStart = lines[prevIndex].time;
  const lineEnd = getLineEndTime(lines, prevIndex, trackDuration);
  const gap = Math.max(0, lineEnd - lineStart);
  if (gap <= 0) return state;

  const mapping = getLineRevealMapping(text, lineStart, lineEnd, lines, prevIndex, state);
  const completion = getLineCompletionProgress(charCount, switchTime, lineStart, mapping);
  const elapsedAtSwitch = Math.max(0, switchTime - lineStart);
  const timeRatio = elapsedAtSwitch / gap;

  let speedMultiplier = state.speedMultiplier;
  let vocalFill = state.vocalFill;

  if (completion < 0.88 && timeRatio >= 0.82) {
    speedMultiplier *= 1.14;
  } else if (completion < 0.94 && timeRatio >= 0.92) {
    speedMultiplier *= 1.08;
  } else if (completion >= 0.98 && timeRatio < 0.72) {
    speedMultiplier *= 0.9;
  } else if (completion >= 0.98 && timeRatio < 0.86) {
    speedMultiplier *= 0.95;
  } else {
    speedMultiplier += (1 - speedMultiplier) * 0.12;
  }

  speedMultiplier = clamp(speedMultiplier, 0.72, 1.42);

  if (completion >= 0.94 && elapsedAtSwitch > 0.2) {
    const measuredFill = clamp(elapsedAtSwitch / gap, 0.5, 0.995);
    vocalFill = vocalFill * 0.65 + measuredFill * 0.35;
  }

  vocalFill = clamp(vocalFill, 0.62, 0.995);

  return { speedMultiplier, vocalFill };
}

export function plainTextToLines(plainText) {
  if (!plainText || typeof plainText !== 'string') return [];
  return plainText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
