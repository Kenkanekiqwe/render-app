function buildArtistWeights(history, likedTracks) {
  const weights = new Map();

  history.forEach((track, index) => {
    const weight = Math.max(1, history.length - index);
    weights.set(track.artist, (weights.get(track.artist) || 0) + weight * 2);
  });

  likedTracks.forEach((track, index) => {
    const weight = Math.max(1, likedTracks.length - index);
    weights.set(track.artist, (weights.get(track.artist) || 0) + weight);
  });

  return weights;
}

function buildTrackPool(history, likedTracks) {
  const seen = new Set();
  const pool = [];

  for (const track of [...history, ...likedTracks]) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    pool.push(track);
  }

  return pool;
}

export function getPersonalizedTracks(history, likedTracks, fallbackTracks = [], limit = 10) {
  const pool = buildTrackPool(history, likedTracks);
  const weights = buildArtistWeights(history, likedTracks);
  const rankedArtists = new Set(
    [...weights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([artist]) => artist)
  );

  const recentIds = new Set((history || []).slice(0, 6).map((track) => track.id));
  const catalog = [];
  const used = new Set();

  const push = (track) => {
    if (!track?.id || used.has(track.id) || recentIds.has(track.id)) return;
    used.add(track.id);
    catalog.push(track);
  };

  for (const track of fallbackTracks) {
    if (rankedArtists.has(track.artist)) push(track);
  }
  for (const track of pool) push(track);
  for (const track of fallbackTracks) push(track);

  if (!catalog.length) {
    return (pool.length ? pool : fallbackTracks).slice(0, limit);
  }

  return catalog.slice(0, limit);
}

export function getTopArtists(history, likedTracks, fallbackTracks = [], limit = 12) {
  const weights = buildArtistWeights(history, likedTracks);
  const artistTracks = new Map();

  [...history, ...likedTracks, ...fallbackTracks].forEach((track) => {
    if (!artistTracks.has(track.artist)) {
      artistTracks.set(track.artist, track);
    }
  });

  const ranked = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([artist]) => artistTracks.get(artist))
    .filter(Boolean);

  const used = new Set(ranked.map((track) => track.artist));

  for (const track of fallbackTracks) {
    if (!used.has(track.artist)) {
      ranked.push(track);
      used.add(track.artist);
      if (ranked.length >= limit) break;
    }
  }

  return ranked.slice(0, limit);
}

export function getWavePreviewCovers(history, likedTracks, fallbackTracks = [], limit = 5) {
  return getPersonalizedTracks(history, likedTracks, fallbackTracks, limit)
    .map((track) => track.cover)
    .filter(Boolean);
}
