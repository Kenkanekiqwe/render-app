import axios from 'axios';
import { filterValidTracks } from './tracks';

function uniqTracks(list = []) {
  const seen = new Set();
  const out = [];
  for (const track of list) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

function shuffle(list = []) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sameArtist(trackArtist, seedName) {
  const a = String(trackArtist || '').trim().toLowerCase();
  const b = String(seedName || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

export function applyWaveFilters(tracks = [], {
  noExplicit = false,
  likedOnly = false,
  likedTracks = [],
  noRecentRepeats = false,
  history = [],
} = {}) {
  let out = Array.isArray(tracks) ? tracks : [];
  if (noExplicit) {
    out = out.filter((track) => !track?.explicit);
  }
  if (likedOnly) {
    const artists = new Set(
      likedTracks.map((track) => String(track?.artist || '').trim().toLowerCase()).filter(Boolean)
    );
    out = out.filter((track) => artists.has(String(track?.artist || '').trim().toLowerCase()));
  }
  if (noRecentRepeats) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = new Set(
      history
        .filter((track) => Number(track?.playedAt) > cutoff)
        .map((track) => String(track.id))
    );
    out = out.filter((track) => !recent.has(String(track?.id)));
  }
  return out;
}

export function getSeedArtists(history = [], likedTracks = []) {
  const weights = new Map();
  const ids = new Map();

  const bump = (track, amount) => {
    const name = String(track?.artist || '').trim();
    if (!name) return;
    weights.set(name, (weights.get(name) || 0) + amount);
    if (track.artistId && !ids.has(name)) ids.set(name, track.artistId);
  };

  likedTracks.forEach((track, index) => {
    bump(track, Math.max(3, (likedTracks.length - index) * 4));
  });
  history.slice(0, 30).forEach((track, index) => {
    bump(track, Math.max(1, 30 - index));
  });

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, weight]) => ({ name, id: ids.get(name) || null, weight }));
}

export function buildWaveQueue(history = [], likedTracks = [], fallbackTracks = [], filters = {}) {
  const seedHistory = filters.likedOnly ? [] : history;
  const seeds = getSeedArtists(seedHistory, likedTracks);
  const seedNames = seeds.map((item) => item.name);
  if (!seedNames.length) return [];

  const lastId = history[0]?.id;
  const likedIds = new Set(likedTracks.map((track) => track.id));
  const pool = uniqTracks([...fallbackTracks, ...history, ...likedTracks]).filter((track) => (
    track.id !== lastId && seedNames.some((name) => sameArtist(track.artist, name))
  ));

  const discovery = shuffle(pool.filter((track) => !likedIds.has(track.id)));
  const familiar = shuffle(pool.filter((track) => likedIds.has(track.id)));
  const radio = discovery.length ? discovery : familiar;
  const queue = [];
  const used = new Set();

  const take = (bucket) => {
    while (bucket.length) {
      const track = bucket.shift();
      if (track && !used.has(track.id)) {
        used.add(track.id);
        return track;
      }
    }
    return null;
  };

  while (queue.length < 20) {
    const pick = queue.length % 6 === 5
      ? (take(familiar) || take(radio))
      : (take(radio) || take(familiar));
    if (!pick) break;
    queue.push(pick);
  }

  return applyWaveFilters(queue, {
    ...filters,
    likedTracks,
    history,
  });
}

export function mergeWaveQueues(base = [], incoming = [], currentId = null) {
  const remote = uniqTracks(incoming);
  if (remote.length >= 6) {
    const current = remote.find((track) => track.id === currentId)
      || uniqTracks(base).find((track) => track.id === currentId);
    const rest = shuffle(remote.filter((track) => track.id !== current?.id));
    return (current ? [current, ...rest] : rest).slice(0, 36);
  }
  return uniqTracks([...remote, ...base]).slice(0, 36);
}

export async function fetchRemoteWave({
  history = [],
  likedTracks = [],
  excludeIds = [],
  likedOnly = false,
  noExplicit = false,
} = {}) {
  const seeds = getSeedArtists(likedOnly ? [] : history, likedTracks);
  if (!seeds.length) return [];

  const { data } = await axios.get('/api/wave', {
    params: {
      artists: seeds.map((item) => item.name).join('|'),
      ids: seeds.map((item) => item.id).filter(Boolean).join(','),
      exclude: excludeIds.filter(Boolean).join(','),
      limit: 36,
      noExplicit: noExplicit ? 1 : undefined,
    },
  });

  return filterValidTracks(Array.isArray(data) ? data : data?.tracks);
}
