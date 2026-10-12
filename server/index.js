const http = require('http');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
dotenv.config();

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { initDiscordRpc, updatePresence, clearPresence, isEnabled } = require('./discord-rpc');
const { resolveLyrics } = require('./lyrics');
const { wrapMediaProxyUrl, unwrapMediaProxyUrl, registerSoundCloudProxyRoutes } = require('./soundcloud-proxy');
const { hasOutboundHop, hopLabel } = require('./outbound-proxy');
const {
  scGet,
  warmUp,
  useOfficialApi,
  hasOfficialCredentials,
  apiHeaders,
  getAccessToken,
  resolveTrackStreams,
  userUrn,
} = require('./soundcloud-api');
const db = require('./db');
const { router: authRouter } = require('./auth');
const { router: accountStateRouter } = require('./account-state');
const { router: friendsRouter } = require('./friends');
const { router: chatRouter } = require('./chat');
const { router: commentsRouter } = require('./comments');
const { router: stickersRouter, UPLOAD_DIR: STICKERS_UPLOAD_DIR } = require('./stickers');
const { router: usersRouter } = require('./users');
const { router: workshopRouter } = require('./workshop');
const { router: marketplaceRouter } = require('./marketplace');
const { router: adminRouter } = require('./admin');
const { attachCallSignaling } = require('./calls');

const app = express();
const PORT = process.env.PORT || 5000;

function isDesktopMode() {
  return process.env.RENDER_DESKTOP === '1';
}

function isSilentMode() {
  return process.env.RENDER_SILENT === '1' || isDesktopMode();
}

function isQuietMode() {
  return (
    isSilentMode() ||
    process.env.RENDER_QUIET === '1' ||
    (process.env.NODE_ENV === 'production' && process.env.RENDER_VERBOSE !== '1')
  );
}

function log(...args) {
  if (!isQuietMode()) {
    console.log(...args);
  }
}

function warn(...args) {
  if (!isQuietMode()) {
    console.warn(...args);
  }
}

function errorLog(...args) {
  if (!isQuietMode()) {
    console.error(...args);
  }
}

function startupLog(...args) {
  console.log(...args);
}

const MAX_RESULTS = 200;
const PAGE_SIZE = 50;
const HOME_TRACKS_LIMIT = 40;
const SEARCH_TRACKS_LIMIT = 50;
const SEARCH_ARTISTS_LIMIT = 20;
const ARTIST_TRACKS_LIMIT = 50;
const ARTIST_PLAYLISTS_LIMIT = 30;
const SIMILAR_ARTISTS_LIMIT = 12;
const IMPORT_TRACKS_LIMIT = 120;

const apiCache = new Map();
const inflightRequests = new Map();
const CACHE_MAX_ENTRIES = 80;

function trimApiCache() {
  while (apiCache.size > CACHE_MAX_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    apiCache.delete(oldest);
  }
}

function getFromCache(key) {
  const entry = apiCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (entry) apiCache.delete(key);
    return null;
  }
  apiCache.delete(key);
  apiCache.set(key, entry);
  return entry.data;
}

function setCache(key, data, ttlMs) {
  if (apiCache.has(key)) apiCache.delete(key);
  apiCache.set(key, { data, expires: Date.now() + ttlMs });
  trimApiCache();
}

async function cached(key, ttlMs, loader) {
  const hit = getFromCache(key);
  if (hit !== null) return hit;

  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((data) => {
      setCache(key, data, ttlMs);
      inflightRequests.delete(key);
      return data;
    })
    .catch((error) => {
      inflightRequests.delete(key);
      throw error;
    });

  inflightRequests.set(key, promise);
  return promise;
}

app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '10mb' }));
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const uploadsRoot = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(STICKERS_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(uploadsRoot, { recursive: true });
app.use('/uploads', express.static(uploadsRoot, { maxAge: '7d' }));

app.use('/api/auth', authRouter);
app.use('/api/account-state', accountStateRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/chat', chatRouter);
app.use(commentsRouter);
app.use('/api/stickers', stickersRouter);
app.use('/api/users', usersRouter);
app.use('/api/workshop', workshopRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/admin', adminRouter);

async function fetchCollection(endpoint, params = {}, maxItems = MAX_RESULTS) {
  const limit = Math.min(PAGE_SIZE, maxItems);
  let data = await scGet(endpoint, { ...params, limit, linked_partitioning: 1 });
  const items = [...(data.collection || [])];

  while (data.next_href && items.length < maxItems) {
    data = await scGet(data.next_href);
    items.push(...(data.collection || []));
  }

  return items.slice(0, maxItems);
}

function sanitizeArtistDescription(text) {
  if (!text) return '';

  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCover(track) {
  let url = 'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg';
  if (track.artwork_url) {
    url = track.artwork_url.replace('-large', '-t500x500');
  } else if (track.user?.avatar_url) {
    url = track.user.avatar_url.replace('-large', '-t500x500');
  }
  return wrapMediaProxyUrl(url);
}

function formatCoverThumb(track) {
  let url = 'https://i1.sndcdn.com/artworks-000000000000-000000-t67x67.jpg';
  if (track.artwork_url) {
    url = track.artwork_url.replace('-large', '-t67x67');
  } else if (track.user?.avatar_url) {
    url = track.user.avatar_url.replace('-large', '-t67x67');
  }
  return wrapMediaProxyUrl(url);
}

function formatAvatar(url) {
  const resolved = !url
    ? 'https://a1.sndcdn.com/images/default_avatar_large.png'
    : url.replace('-large', '-t500x500');
  return wrapMediaProxyUrl(resolved);
}

function formatArtist(user) {
  if (!user) return null;

  const location = [user.city, user.country].filter(Boolean).join(', ');
  const visual = user.visuals?.visuals?.[0]?.visual_url;

  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name || user.username,
    avatar: formatAvatar(user.avatar_url),
    banner: visual
      ? visual.replace('-large', '-t500x500')
      : formatAvatar(user.avatar_url),
    location,
    countryCode: user.country_code || '',
    followers: user.followers_count || 0,
    trackCount: user.track_count || 0,
    verified: Boolean(user.verified),
    permalink: user.permalink_url,
    description: sanitizeArtistDescription(user.description),
  };
}

function formatPlaylist(playlist) {
  const artwork = playlist.artwork_url || playlist.tracks?.[0]?.artwork_url;

  return {
    id: playlist.id,
    name: playlist.title,
    description: sanitizeArtistDescription(playlist.description),
    cover: artwork
      ? artwork.replace('-large', '-t500x500')
      : formatCover({ user: playlist.user }),
    trackCount: playlist.track_count || 0,
    permalink: playlist.permalink_url,
    artist: playlist.user?.username || '',
    artistName: playlist.user?.full_name || playlist.user?.username || '',
  };
}

function normalizeImportText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
    .replace(/\s+(official\s*)?(music\s*)?(video|audio|visualizer|lyrics?|lyric\s*video)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPageTitle(html) {
  const ogTitle = String(html || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle?.[1]) return ogTitle[1];

  const title = String(html || '').match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!title?.[1]) return '';

  return title[1]
    .replace(/\s*[-|]\s*(YouTube Music|YouTube|Spotify|Apple Music|Deezer|Yandex Music|SoundCloud).*$/i, '')
    .trim();
}

function extractImportQueries(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n|;|\t/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const tokens = lines.length > 1 ? lines : raw.split(/,\s*(?=[^,]{3,80}(?:\s[-–—]\s|$))/g);
  const seen = new Set();
  const queries = [];

  tokens.forEach((token) => {
    const query = normalizeImportText(token);
    const key = query.toLowerCase();
    if (!query || query.length < 2 || seen.has(key)) return;
    seen.add(key);
    queries.push(query);
  });

  return queries.slice(0, IMPORT_TRACKS_LIMIT);
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
}

async function resolveSoundCloudUrl(url) {
  const data = await scGet('/resolve', { url });
  if (data?.kind === 'playlist' || data?.tracks) {
    return loadSoundCloudPlaylist(data);
  }
  if (data?.kind === 'track' || data?.permalink_url) {
    const track = formatTrack(data);
    return track
      ? {
          name: data.title || 'Imported playlist',
          description: 'Imported from SoundCloud',
          cover: formatCover(data),
          tracks: [track],
          source: 'soundcloud',
        }
      : null;
  }
  return null;
}

async function resolveTitleFromUrl(url) {
  try {
    const { data } = await axios.get(url, {
      headers: apiHeaders,
      timeout: 10000,
      maxRedirects: 4,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return normalizeImportText(extractPageTitle(data));
  } catch {
    return '';
  }
}

async function resolveTracksByIds(ids) {
  if (!ids.length) return [];

  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const resolved = new Map();
  const chunks = [];

  for (let i = 0; i < uniqueIds.length; i += 50) {
    chunks.push(uniqueIds.slice(i, i + 50));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const data = await scGet('/tracks', { ids: chunk.join(',') });
        const list = Array.isArray(data)
          ? data
          : data.collection || Object.values(data).filter((item) => item && item.id);

        list.forEach((track) => {
          if (track?.id) resolved.set(track.id, track);
        });
      } catch {
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const track = await scGet(`/tracks/${id}`);
              if (track?.id) resolved.set(track.id, track);
            } catch {
              // skip unavailable track
            }
          })
        );
      }
    })
  );

  return ids.map((id) => resolved.get(id)).filter(Boolean);
}

function formatTrack(track) {
  if (!track?.id || !track?.title || !track?.permalink_url) return null;

  const durationSec = Math.floor((track.duration || 0) / 1000);
  if (durationSec <= 0) return null;

  const artistName = track.user?.username || track.label_name;
  if (!artistName) return null;

  return {
    id: track.id,
    title: track.title,
    artist: artistName,
    artistId: track.user?.id || null,
    album: track.publisher_metadata?.album_title || artistName || 'SoundCloud',
    duration: durationSec,
    cover: formatCover(track),
    coverThumb: formatCoverThumb(track),
    plays: track.playback_count || 0,
    soundcloudUrl: track.permalink_url,
    explicit: Boolean(
      track.publisher_metadata?.explicit === true
      || track.publisher_metadata?.explicit === 1
      || track.publisher_metadata?.explicit === '1'
    ),
  };
}

function formatTracks(items) {
  return (items || []).map(formatTrack).filter(Boolean);
}

async function searchBestTrack(query) {
  if (!query) return null;

  const items = await fetchCollection('/tracks', { q: query, access: 'playable' }, 8).catch(() => []);
  const tracks = formatTracks(items);
  if (!tracks.length) return null;

  const wanted = normalizeImportText(query).toLowerCase();
  return tracks
    .map((track) => {
      const full = normalizeImportText(`${track.artist} ${track.title}`).toLowerCase();
      const title = normalizeImportText(track.title).toLowerCase();
      let score = 0;
      if (title === wanted || full === wanted) score += 50;
      if (full.includes(wanted) || wanted.includes(title)) score += 24;
      if (track.plays) score += Math.min(12, Math.log10(track.plays + 1) * 2);
      return { track, score };
    })
    .sort((a, b) => b.score - a.score)[0].track;
}

async function loadSoundCloudPlaylist(playlistData) {
  const rawTracks = playlistData.tracks || [];
  const trackIds = rawTracks
    .map((item) => item.track?.id || item.id)
    .filter(Boolean);

  const resolvedTracks = await resolveTracksByIds(trackIds);
  const tracks = formatTracks(resolvedTracks.length ? resolvedTracks : rawTracks);

  return {
    ...formatPlaylist(playlistData),
    tracks,
    source: 'soundcloud',
  };
}

async function importPlaylistPayload(input, fallbackName) {
  const text = String(input || '').trim();
  const urls = extractUrls(text);

  for (const url of urls) {
    if (/soundcloud\.com/i.test(url)) {
      const playlist = await resolveSoundCloudUrl(url).catch(() => null);
      if (playlist?.tracks?.length) return playlist;
    }
  }

  const urlTitles = await Promise.all(urls.slice(0, 25).map(resolveTitleFromUrl));
  const queries = [
    ...extractImportQueries(text),
    ...urlTitles.filter(Boolean),
  ];

  const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  const tracks = [];
  const seenTracks = new Set();

  for (const query of uniqueQueries.slice(0, IMPORT_TRACKS_LIMIT)) {
    const track = await searchBestTrack(query);
    if (!track || seenTracks.has(track.id)) continue;
    seenTracks.add(track.id);
    tracks.push(track);
  }

  const firstCover = tracks[0]?.cover;
  return {
    name: fallbackName || 'Imported playlist',
    description: 'Imported from links or text',
    cover: firstCover || 'https://i1.sndcdn.com/artworks-000000000000-000000-t500x500.jpg',
    tracks,
    source: 'universal',
  };
}

async function loadPopularTracks(limit = HOME_TRACKS_LIMIT) {
  try {
    const data = await scGet('/charts', {
      kind: 'trending',
      genre: 'soundcloud:genres:all-music',
      limit: Math.min(limit, PAGE_SIZE),
    });

    if (data?.collection?.length) {
      const ids = data.collection
        .map((item) => item.track?.id)
        .filter(Boolean);

      if (ids.length) {
        const resolved = await resolveTracksByIds(ids);
        const tracks = formatTracks(resolved);
        if (tracks.length) return tracks.slice(0, limit);
      }
    }
  } catch {
    // charts are legacy-only; fall through to search
  }

  // Prefer tracks streamable in this server region (filters geo-blocks).
  const items = await fetchCollection(
    '/tracks',
    { q: 'popular', access: 'playable' },
    limit
  );
  return formatTracks(items);
}

async function loadSimilarArtists(userId) {
  const endpoints = useOfficialApi()
    ? [`/users/${userUrn(userId)}/related`]
    : [
        `/users/${userId}/similar_producers`,
        `/users/${userId}/relatedartists`,
        `/users/${userId}/related`,
      ];

  const results = await Promise.all(
    endpoints.map((endpoint) =>
      fetchCollection(endpoint, {}, SIMILAR_ARTISTS_LIMIT).catch(() => [])
    )
  );

  for (const items of results) {
    if (items.length) {
      return items.map(formatArtist).filter(Boolean).slice(0, SIMILAR_ARTISTS_LIMIT);
    }
  }

  return [];
}

async function loadArtistProfile(userId) {
  const userData = await scGet(`/users/${userId}`);
  const [trackItems, playlistItems, similar] = await Promise.all([
    fetchCollection(`/users/${userId}/tracks`, {}, ARTIST_TRACKS_LIMIT).catch(() => []),
    fetchCollection(`/users/${userId}/playlists`, {}, ARTIST_PLAYLISTS_LIMIT).catch(() => []),
    loadSimilarArtists(userId).catch(() => []),
  ]);

  const artist = formatArtist(userData);
  if (!artist) {
    throw new Error('Артист не найден');
  }

  const tracks = formatTracks(trackItems).sort((a, b) => (b.plays || 0) - (a.plays || 0));

  return {
    artist,
    tracks,
    playlists: playlistItems.map(formatPlaylist),
    similar,
  };
}

async function resolveArtistByUsername(username) {
  const items = await fetchCollection('/users', { q: username }, 10);
  const artists = items.map(formatArtist).filter(Boolean);
  const normalized = username.toLowerCase();

  return (
    artists.find((artist) => artist.username?.toLowerCase() === normalized) ||
    artists[0] ||
    null
  );
}

registerSoundCloudProxyRoutes(app, {
  resolveStream: resolveTrackStreams,
  getAccessToken: hasOfficialCredentials() ? getAccessToken : null,
});

async function loadWaveTracks({ artistIds = [], artistNames = [], limit = 36 } = {}) {
  const ids = [...new Set(artistIds.map((id) => String(id).trim()).filter(Boolean))].slice(0, 6);
  const names = [...new Set(artistNames.map((name) => String(name).trim()).filter(Boolean))].slice(0, 6);
  const nameSet = names.map((name) => name.toLowerCase());
  const idSet = new Set(ids);

  const matchesSeed = (track) => {
    if (track.artistId && idSet.has(String(track.artistId))) return true;
    const artist = String(track.artist || '').trim().toLowerCase();
    return nameSet.some((name) => artist === name || artist.startsWith(`${name} `) || name.startsWith(`${artist} `));
  };

  const uniqueById = (list) => {
    const seen = new Set();
    return list.filter((track) => {
      if (!track?.id || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  };

  const relatedLists = await Promise.all(
    ids.slice(0, 4).map((id) => loadSimilarArtists(id).catch(() => []))
  );
  const relatedIds = relatedLists
    .flat()
    .map((artist) => artist?.id)
    .filter((id) => id && !idSet.has(String(id)))
    .slice(0, 6);

  const [seedGroups, relatedGroups, searchGroups] = await Promise.all([
    Promise.all(ids.map((id) => fetchCollection(`/users/${id}/tracks`, {}, 16).catch(() => []))),
    Promise.all(relatedIds.map((id) => fetchCollection(`/users/${id}/tracks`, {}, 10).catch(() => []))),
    Promise.all(
      names.slice(0, 4).map((name) =>
        fetchCollection('/tracks', { q: name, access: 'playable' }, 10).catch(() => [])
      )
    ),
  ]);

  const seedTracks = uniqueById(formatTracks([...seedGroups.flat(), ...searchGroups.flat()]).filter(matchesSeed));
  const relatedTracks = uniqueById(formatTracks(relatedGroups.flat()).filter((track) => !matchesSeed(track)));

  const shuffleInPlace = (list) => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  const seed = shuffleInPlace(seedTracks);
  const related = shuffleInPlace(relatedTracks);

  const mixed = [];
  let si = 0;
  let ri = 0;
  while (mixed.length < limit && (si < seed.length || ri < related.length)) {
    if (si < seed.length) mixed.push(seed[si++]);
    if (si < seed.length && mixed.length < limit) mixed.push(seed[si++]);
    if (ri < related.length && mixed.length < limit) mixed.push(related[ri++]);
  }

  return mixed.slice(0, limit);
}

app.get('/api/wave', async (req, res) => {
  try {
    const artistNames = String(req.query.artists || '')
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean);
    const artistIds = String(req.query.ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const excludeIds = String(req.query.exclude || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit, 10) || 36, 48);
    const noExplicit = req.query.noExplicit === '1' || req.query.noExplicit === 'true';

    if (!artistNames.length && !artistIds.length) {
      return res.json([]);
    }

    const cacheKey = `wave:${artistIds.join(',')}:${artistNames.join('|').toLowerCase()}:${limit}:${noExplicit ? 1 : 0}`;
    const tracks = await cached(cacheKey, 4 * 60 * 1000, () =>
      loadWaveTracks({ artistIds, artistNames, limit: Math.max(limit, 36) })
    );
    const blocked = new Set(excludeIds);
    res.json(
      tracks
        .filter((track) => !blocked.has(String(track.id)))
        .filter((track) => !noExplicit || !track.explicit)
        .slice(0, limit)
    );
  } catch (error) {
    errorLog('❌ Ошибка волны:', error.message);
    res.json([]);
  }
});

app.get('/api/tracks', async (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || HOME_TRACKS_LIMIT,
      MAX_RESULTS
    );
    const tracks = await cached(`tracks:popular:${limit}`, 5 * 60 * 1000, () =>
      loadPopularTracks(limit)
    );
    log(`✅ Загружено ${tracks.length} треков`);
    res.json(tracks);
  } catch (error) {
    errorLog('❌ Ошибка загрузки треков:', error.message);
    res.status(500).json({
      error: 'Не удалось загрузить треки из SoundCloud',
      message: error.message,
    });
  }
});

app.get('/api/tracks/:id', async (req, res) => {
  try {
    const trackData = await scGet(`/tracks/${req.params.id}`);
    res.json(formatTrack(trackData));
  } catch (error) {
    errorLog('❌ Ошибка загрузки трека:', error.message);
    res.status(404).json({ error: 'Трек не найден' });
  }
});

app.get('/api/lyrics', async (req, res) => {
  const title = req.query.title?.trim();
  const artist = req.query.artist?.trim() || '';
  const duration = parseInt(req.query.duration, 10);

  if (!title) {
    return res.json({ synced: null, plain: null });
  }

  const cacheKey = `lyrics:${title.toLowerCase()}:${artist.toLowerCase()}:${duration || 0}`;

  try {
    const payload = await cached(cacheKey, 30 * 60 * 1000, () =>
      resolveLyrics(title, artist, Number.isFinite(duration) && duration > 0 ? duration : null)
    );

    res.json(payload);
  } catch (error) {
    errorLog('❌ Ошибка загрузки текста:', error.message);
    res.json({ synced: null, plain: null });
  }
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q?.trim() || '';

  if (!query) {
    return res.json({ tracks: [], artists: [] });
  }

  const trackLimit = Math.min(
    parseInt(req.query.trackLimit, 10) || SEARCH_TRACKS_LIMIT,
    MAX_RESULTS
  );
  const artistLimit = Math.min(
    parseInt(req.query.artistLimit, 10) || SEARCH_ARTISTS_LIMIT,
    50
  );
  const cacheKey = `search:${query.toLowerCase()}:${trackLimit}:${artistLimit}`;

  try {
    const payload = await cached(cacheKey, 2 * 60 * 1000, async () => {
      const [tracksData, usersData] = await Promise.all([
        fetchCollection('/tracks', { q: query, access: 'playable' }, trackLimit),
        fetchCollection('/users', { q: query }, artistLimit).catch(() => []),
      ]);

      return {
        tracks: formatTracks(tracksData),
        artists: usersData.map(formatArtist).filter(Boolean),
      };
    });

    log(
      `🔍 Найдено ${payload.tracks.length} треков и ${payload.artists.length} артистов для "${query}"`
    );
    res.json(payload);
  } catch (error) {
    errorLog('❌ Ошибка поиска:', error.message);
    res.json({ tracks: [], artists: [] });
  }
});

app.get('/api/artists/resolve', async (req, res) => {
  const username = req.query.username?.trim();
  if (!username) {
    return res.json(null);
  }

  try {
    const artist = await cached(
      `artist:resolve:${username.toLowerCase()}`,
      30 * 60 * 1000,
      () => resolveArtistByUsername(username)
    );
    res.json(artist);
  } catch (error) {
    errorLog('❌ Ошибка resolve артиста:', error.message);
    res.json(null);
  }
});

app.get('/api/artists/:id/profile', async (req, res) => {
  try {
    const profile = await cached(
      `artist:profile:${req.params.id}`,
      3 * 60 * 1000,
      () => loadArtistProfile(req.params.id)
    );
    res.json(profile);
  } catch (error) {
    errorLog('❌ Ошибка загрузки профиля артиста:', error.message);
    res.status(404).json({ error: 'Артист не найден' });
  }
});

app.get('/api/artists/:id', async (req, res) => {
  try {
    const artist = await cached(`artist:${req.params.id}`, 5 * 60 * 1000, async () => {
      const userData = await scGet(`/users/${req.params.id}`);
      return formatArtist(userData);
    });

    if (!artist) {
      return res.status(404).json({ error: 'Артист не найден' });
    }
    res.json(artist);
  } catch (error) {
    errorLog('❌ Ошибка загрузки артиста:', error.message);
    res.status(404).json({ error: 'Артист не найден' });
  }
});

app.get('/api/artists/:id/similar', async (req, res) => {
  try {
    const similar = await cached(
      `artist:similar:${req.params.id}`,
      10 * 60 * 1000,
      () => loadSimilarArtists(req.params.id)
    );
    res.json(similar);
  } catch {
    res.json([]);
  }
});

app.get('/api/artists/:id/tracks', async (req, res) => {
  const sort = req.query.sort === 'popular' ? 'popular' : 'all';
  const cacheKey = `artist:tracks:${req.params.id}:${sort}`;

  try {
    const tracks = await cached(cacheKey, 3 * 60 * 1000, async () => {
      const items = await fetchCollection(
        `/users/${req.params.id}/tracks`,
        {},
        ARTIST_TRACKS_LIMIT
      );
      let formatted = formatTracks(items);
      if (sort === 'popular') {
        formatted = formatted.sort((a, b) => (b.plays || 0) - (a.plays || 0));
      }
      return formatted;
    });

    res.json(tracks);
  } catch (error) {
    errorLog('❌ Ошибка загрузки треков артиста:', error.message);
    res.status(404).json({ error: 'Треки не найдены' });
  }
});

app.get('/api/artists/:id/playlists', async (req, res) => {
  try {
    const playlists = await cached(
      `artist:playlists:${req.params.id}`,
      5 * 60 * 1000,
      async () => {
        const items = await fetchCollection(
          `/users/${req.params.id}/playlists`,
          {},
          ARTIST_PLAYLISTS_LIMIT
        );
        return items.map(formatPlaylist);
      }
    );
    res.json(playlists);
  } catch (error) {
    errorLog('❌ Ошибка загрузки плейлистов артиста:', error.message);
    res.json([]);
  }
});

app.get('/api/sc-playlists/:id', async (req, res) => {
  try {
    const payload = await cached(`sc-playlist:${req.params.id}`, 5 * 60 * 1000, async () => {
      const data = await scGet(`/playlists/${req.params.id}`, { representation: 'full' });
      return loadSoundCloudPlaylist(data);
    });

    res.json(payload);
  } catch (error) {
    errorLog('❌ Ошибка загрузки плейлиста:', error.message);
    res.status(404).json({ error: 'Плейлист не найден' });
  }
});

app.post('/api/import-playlist', async (req, res) => {
  const input = String(req.body?.input || '').trim();
  const name = String(req.body?.name || '').trim();

  if (!input) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }

  try {
    const cacheKey = `import:${Buffer.from(`${name}:${input}`).toString('base64').slice(0, 120)}`;
    const payload = await cached(cacheKey, 5 * 60 * 1000, () => importPlaylistPayload(input, name));

    res.json({
      ...payload,
      requestedName: name,
      matchedCount: payload.tracks?.length || 0,
    });
  } catch (error) {
    errorLog('❌ Ошибка импорта плейлиста:', error.message);
    res.status(500).json({ error: 'Не удалось импортировать плейлист', message: error.message });
  }
});

app.get('/api/playlists', (req, res) => {
  res.json([]);
});

app.get('/api/playlists/:id', (req, res) => {
  res.json({
    id: req.params.id,
    name: 'Плейлист',
    tracks: [],
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: db.isReady(),
    uptime: Math.round(process.uptime()),
  });
});

app.post('/api/discord-presence', async (req, res) => {
  if (!isEnabled()) {
    return res.json({ ok: false, disabled: true });
  }

  const { title, artist, cover, isPlaying, idle } = req.body || {};

  if (idle || !title) {
    const ok = await updatePresence({ idle: true });
    return res.json({ ok, idle: true });
  }

  const ok = await updatePresence({
    title,
    artist,
    cover,
    isPlaying: Boolean(isPlaying),
  });
  res.json({ ok });
});

function resolveClientBuildPath() {
  const execDir = path.dirname(process.execPath);
  const candidates = [];

  if (process.env.CLIENT_BUILD_PATH) {
    candidates.push(process.env.CLIENT_BUILD_PATH);
  }

  candidates.push(
    path.join(execDir, 'client', 'build'),
    path.join(execDir, 'build'),
    path.join(__dirname, '..', 'client', 'build'),
    path.join(process.cwd(), 'client', 'build'),
    path.join(process.cwd(), 'build')
  );

  if (process.pkg) {
    candidates.unshift(
      path.join(__dirname, '..', 'client', 'build'),
      path.join(execDir, 'client', 'build')
    );
  }

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
}

function mountDesktopFrontend() {
  const buildPath = resolveClientBuildPath();
  if (!buildPath) {
    warn('⚠️  React build не найден, API-only режим');
    return false;
  }

  app.get('/.well-known/*', (_req, res) => {
    res.status(204).end();
  });

  app.use(
    '/static',
    express.static(path.join(buildPath, 'static'), {
      maxAge: '365d',
      immutable: true,
      fallthrough: true,
    })
  );

  app.use(
    express.static(buildPath, {
      index: false,
      fallthrough: true,
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }

    if (path.extname(req.path)) {
      res.status(404).end();
      return;
    }

    res.sendFile(path.join(buildPath, 'index.html'));
  });

  log(`📦 Desktop UI: ${buildPath}`);
  return true;
}

async function startServer() {
  if (isDesktopMode() || process.env.SERVE_CLIENT === '1') {
    mountDesktopFrontend();
  }

  // Must be registered last so it catches errors from every route/middleware,
  // including malformed URLs from bot scanners (e.g. /cgi-bin/%%32%65...).
  app.use((err, req, res, _next) => {
    if (err instanceof URIError) {
      return res.status(400).json({ error: 'Bad request' });
    }
    warn('❌ Необработанная ошибка запроса:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  const HOST = process.env.HOST || (isDesktopMode() ? '127.0.0.1' : '0.0.0.0');

  const server = http.createServer(app);
  attachCallSignaling(server);

  const started = await new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      startupLog(`
╔═══════════════════════════════════════════════════════════╗
║           🎵  RENDER - SOUNDCLOUD PLAYER  🎵              ║
╚═══════════════════════════════════════════════════════════╝

🟢 Сервер: http://${HOST}:${PORT}
${isDesktopMode() ? '🖥️  Desktop mode (quiet logs)' : isQuietMode() ? '🔇 Quiet logs (RENDER_VERBOSE=1 for details)' : '🎧 Клиент: http://localhost:3000'}
🎵 Воспроизведение через серверный прокси SoundCloud
      `);
      if (!hasOutboundHop()) {
        warn('⚠️  Нет исходящего хопа к SoundCloud (CLOUDFLARE WORKER или SOCKS). Из РФ CDN часто недоступен.');
      } else {
        log(`🌐 Исходящий хоп SoundCloud: ${hopLabel()}`);
      }
      resolve({ port: PORT });
    });
  });

  db.init()
    .then(() => log('✅ MariaDB подключена'))
    .catch((error) => {
      warn(`⚠️  MariaDB недоступна — аккаунты отключены (${error.code || error.message})`);
    });

  warmUp()
    .then((status) => {
      log(status.mode === 'official'
        ? '✅ SoundCloud Official API подключён (OAuth)'
        : '✅ SoundCloud legacy api-v2 подключён (client_id scrape)');
    })
    .catch((error) => {
      warn(`⚠️  SoundCloud будет инициализирован при первом запросе (${error.message})`);
    });

  if (isEnabled()) {
    initDiscordRpc()
      .then((connected) => {
        if (connected) {
          log('✅ Discord Rich Presence (server) подключён');
        }
      })
      .catch(() => {
        warn('⚠️  Discord Rich Presence недоступен (запустите Discord Desktop)');
      });
  }

  return started;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, PORT, isDesktopMode };

