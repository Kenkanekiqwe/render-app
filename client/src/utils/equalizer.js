export const EQ_BANDS = [
  { id: '60', freq: 60, label: '60' },
  { id: '170', freq: 170, label: '170' },
  { id: '310', freq: 310, label: '310' },
  { id: '600', freq: 600, label: '600' },
  { id: '1k', freq: 1000, label: '1K' },
  { id: '3k', freq: 3000, label: '3K' },
  { id: '6k', freq: 6000, label: '6K' },
  { id: '12k', freq: 12000, label: '12K' },
  { id: '14k', freq: 14000, label: '14K' },
  { id: '16k', freq: 16000, label: '16K' },
];

export const EQ_PRESETS = {
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass', gains: [7, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  treble: { label: 'Treble', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
  vocal: { label: 'Vocal', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  rock: { label: 'Rock', gains: [5, 4, 2, 0, -1, 0, 2, 4, 5, 5] },
  electronic: { label: 'Electronic', gains: [6, 4, 1, 0, -2, 2, 1, 3, 5, 6] },
};

export function normalizeEqGains(raw) {
  const source = Array.isArray(raw) ? raw : [];
  return EQ_BANDS.map((_, index) => {
    const value = Number(source[index]);
    if (!Number.isFinite(value)) return 0;
    return Math.min(12, Math.max(-12, Math.round(value * 10) / 10));
  });
}

export function createEqualizerChain(audioContext, audioElement, initialGains = []) {
  const source = audioContext.createMediaElementSource(audioElement);
  const filters = EQ_BANDS.map(({ freq }, index) => {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1.1;
    filter.gain.value = initialGains[index] ?? 0;
    return filter;
  });
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = 0;
  compressor.knee.value = 0;
  compressor.ratio.value = 1;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;

  const makeupGain = audioContext.createGain();
  makeupGain.gain.value = 1;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1;

  let node = source;
  filters.forEach((filter) => {
    node.connect(filter);
    node = filter;
  });
  node.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(gainNode);
  gainNode.connect(audioContext.destination);

  return { source, filters, compressor, makeupGain, gainNode };
}

export function applyNormalization(compressor, makeupGain, enabled) {
  if (!compressor || !makeupGain) return;
  const now = compressor.context.currentTime;
  if (enabled) {
    compressor.threshold.setTargetAtTime(-22, now, 0.05);
    compressor.knee.setTargetAtTime(16, now, 0.05);
    compressor.ratio.setTargetAtTime(3.5, now, 0.05);
    compressor.attack.setTargetAtTime(0.012, now, 0.05);
    compressor.release.setTargetAtTime(0.22, now, 0.05);
    makeupGain.gain.setTargetAtTime(1.28, now, 0.08);
    return;
  }

  compressor.threshold.setTargetAtTime(0, now, 0.05);
  compressor.knee.setTargetAtTime(0, now, 0.05);
  compressor.ratio.setTargetAtTime(1, now, 0.05);
  makeupGain.gain.setTargetAtTime(1, now, 0.08);
}

export function applyEqGains(filters, gains) {
  if (!filters?.length) return;
  const normalized = normalizeEqGains(gains);
  filters.forEach((filter, index) => {
    const now = filter.context?.currentTime;
    if (Number.isFinite(now)) {
      filter.gain.setTargetAtTime(normalized[index], now, 0.03);
      return;
    }
    filter.gain.value = normalized[index];
  });
}
