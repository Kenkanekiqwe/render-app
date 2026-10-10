const axios = require('axios');

const LRCLIB_BASE = 'https://lrclib.net/api';
const LYRICS_OVH_BASE = 'https://api.lyrics.ovh/v1';
const GENIUS_API_SEARCH_BASE = 'https://api.genius.com/search';
const GENIUS_API_USER_AGENT = 'RenderMusic/1.0 (+lyrics)';
const MIN_LYRICS_MATCH_SCORE = 42;
const MIN_GENIUS_MATCH_SCORE = 52;

const REQUEST_HEADERS = {
  'User-Agent': 'RenderMusic/1.0',
  Accept: 'application/json',
};

const WEB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json',
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function namesMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const compactA = a.replace(/\s+/g, '');
  const compactB = b.replace(/\s+/g, '');
  if (compactA === compactB) return true;
  if (
    compactA.length >= 5 &&
    compactB.length >= 5 &&
    (compactA.startsWith(compactB) || compactB.startsWith(compactA))
  ) {
    return true;
  }

  if (a.includes(b) || b.includes(a)) {
    const shorter = a.length <= b.length ? a : b;
    if (shorter.split(' ').length === 1 && shorter.length < 8) return false;
    return true;
  }

  return false;
}

function decodeHtmlEntities(value) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  };

  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (entities[key]) return entities[key];
    if (key.startsWith('#x')) {
      return String.fromCharCode(parseInt(key.slice(2), 16));
    }
    if (key.startsWith('#')) {
      return String.fromCharCode(parseInt(key.slice(1), 10));
    }
    return match;
  });
}

function getGeniusAccessToken() {
  return String(process.env.GENIUS_ACCESS_TOKEN || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*[\(\[]\s*(official\s*)?(music\s*)?(video|audio|visualizer|lyrics?|lyric\s*video|remaster(?:ed)?|radio\s*edit|sped\s*up|slowed(?:\s*\+\s*reverb)?|nightcore|prod\..*?)\s*[\)\]]/gi, ' ')
    .replace(/\s*(feat\.?|ft\.?)\s+.*/i, '')
    .replace(/\s*-\s*(official\s*)?(music\s*)?(video|audio|visualizer|lyrics?|lyric\s*video)\s*$/i, '')
    .replace(/\s*\|\s*.*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCandidates(title, artist) {
  const rawTitle = String(title || '').trim();
  const rawArtist = String(artist || '').trim();
  const seen = new Set();
  const candidates = [];

  const splitArtists = (value) => String(value || '')
    .split(/,|;|\/|\s&\s|\s\+\s|\s+x\s+|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const push = (trackName, artistName) => {
    const nextTitle = cleanTitle(trackName);
    const nextArtist = cleanTitle(artistName);
    if (!nextTitle) return;

    const key = `${normalizeText(nextArtist)}::${normalizeText(nextTitle)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ title: nextTitle, artist: nextArtist });
  };

  push(rawTitle, rawArtist);
  push(cleanTitle(rawTitle), rawArtist);

  if (/\s/.test(rawArtist)) {
    push(rawTitle, rawArtist.replace(/\s+/g, ''));
  }
  if (/\s/.test(rawTitle) && /\s/.test(rawArtist)) {
    push(rawTitle.replace(/\s+/g, ''), rawArtist.replace(/\s+/g, ''));
  }

  const dashPatterns = [
    /^(.+?)\s[-–—]\s(.+)$/,
    /^(.+?)\s:\s(.+)$/,
  ];

  dashPatterns.forEach((pattern) => {
    const match = rawTitle.match(pattern);
    if (!match) return;
    push(match[2], match[1]);
    if (rawArtist) push(match[2], rawArtist);
  });

  if (rawArtist && rawTitle) {
    splitArtists(rawArtist).forEach((artistName) => {
      push(rawTitle, artistName);
      push(`${artistName} ${rawTitle}`, artistName);
    });
  }

  return candidates;
}

function scoreResult(result, candidate, duration) {
  if (!result) return -1;

  let score = 0;
  const resultTitle = normalizeText(result.trackName || result.title || result.full_title);
  const resultArtist = normalizeText(
    result.artistName || result.artist || result.artist_names || result.primary_artist?.name
  );
  const wantedTitle = normalizeText(candidate.title);
  const wantedArtist = normalizeText(candidate.artist);

  if (resultTitle === wantedTitle || compactText(resultTitle) === compactText(wantedTitle)) score += 40;
  else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 24;

  if (wantedArtist) {
    if (resultArtist === wantedArtist || compactText(resultArtist) === compactText(wantedArtist)) score += 30;
    else if (
      resultArtist.includes(wantedArtist) ||
      wantedArtist.includes(resultArtist)
    ) {
      score += 18;
    }
  }

  if (result.syncedLyrics) score += 20;
  if (result.plainLyrics || result.plain) score += 10;

  if (duration && result.duration) {
    const delta = Math.abs(Number(result.duration) - Number(duration));
    if (delta <= 2) score += 18;
    else if (delta <= 8) score += 10;
    else if (delta <= 20) score += 4;
  }

  return score;
}

function isConfidentResult(result, candidate, minScore = MIN_LYRICS_MATCH_SCORE) {
  const score = scoreResult(result, candidate, null);
  const resultTitle = normalizeText(result?.trackName || result?.title || result?.full_title);
  const resultArtist = normalizeText(
    result?.artistName || result?.artist || result?.artist_names || result?.primary_artist?.name
  );
  const wantedTitle = normalizeText(candidate.title);
  const wantedArtist = normalizeText(candidate.artist);
  const titleMatches = namesMatch(resultTitle, wantedTitle);
  const artistMatches = !wantedArtist || namesMatch(resultArtist, wantedArtist);

  return titleMatches && artistMatches && score >= minScore;
}

function toPayload(source) {
  if (!source) return null;
  const synced = source.syncedLyrics || source.synced || null;
  const plain = source.plainLyrics || source.plain || source.lyrics || null;
  if (!synced && !plain) return null;
  return { synced, plain };
}

function lrcToPlain(lrc) {
  const plain = String(lrc || '')
    .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.length > 20 ? plain : '';
}

function hasUsableLrc(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/暂无歌词|纯音乐|instrumental/i.test(value) && value.length < 80) return false;
  return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(value);
}

async function fetchLrclibGet(candidate, duration) {
  const params = new URLSearchParams({
    track_name: candidate.title,
    artist_name: candidate.artist || '',
  });

  if (Number.isFinite(duration) && duration > 0) {
    params.set('duration', String(duration));
  }

  const response = await axios.get(`${LRCLIB_BASE}/get?${params.toString()}`, {
    timeout: 7000,
    headers: REQUEST_HEADERS,
    validateStatus: (status) => status === 200 || status === 404,
  });

  if (response.status === 404) return null;
  if (!isConfidentResult(response.data, candidate, MIN_LYRICS_MATCH_SCORE)) return null;
  return toPayload(response.data);
}

async function fetchLrclibSearch(candidate, duration) {
  const requests = [
    { q: `${candidate.title} ${candidate.artist}`.trim() },
    { q: candidate.artist ? `${candidate.artist} ${candidate.title}` : candidate.title },
    { track_name: candidate.title, artist_name: candidate.artist || '' },
  ];
  if (!candidate.artist) {
    requests.push({ q: candidate.title }, { track_name: candidate.title });
  }

  const seen = new Set();
  let best = null;
  let bestScore = -1;

  for (const params of requests) {
    const normalizedParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => String(value || '').trim())
    );
    const key = JSON.stringify(normalizedParams).toLowerCase();
    if (key === '{}' || seen.has(key)) continue;
    seen.add(key);

    const response = await axios.get(`${LRCLIB_BASE}/search?${new URLSearchParams(normalizedParams)}`, {
      timeout: 7000,
      headers: REQUEST_HEADERS,
      validateStatus: (status) => status === 200,
    });

    const results = Array.isArray(response.data) ? response.data : [];
    results.forEach((result) => {
      const score = scoreResult(result, candidate, duration);
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
    });

    if (bestScore >= 50) break;
  }

  if (!best || !isConfidentResult(best, candidate, MIN_LYRICS_MATCH_SCORE)) return null;
  return toPayload(best);
}

async function fetchItunesCanonical(candidate, duration) {
  const term = `${candidate.artist} ${candidate.title}`.trim();
  if (!term) return null;

  const response = await axios.get('https://itunes.apple.com/search', {
    params: { term, entity: 'song', limit: 6 },
    timeout: 6000,
    headers: REQUEST_HEADERS,
    validateStatus: (status) => status === 200,
  });

  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  const mapped = results.map((item) => ({
    trackName: item.trackName,
    artistName: item.artistName,
    duration: Number(item.trackTimeMillis || 0) / 1000,
  }));

  const best = mapped.sort(
    (a, b) => scoreResult(b, candidate, duration) - scoreResult(a, candidate, duration)
  )[0];
  if (!best || !isConfidentResult(best, candidate, MIN_LYRICS_MATCH_SCORE)) return null;

  return {
    title: String(best.trackName || '').trim(),
    artist: String(best.artistName || '').trim(),
    duration: best.duration || duration || null,
  };
}

async function fetchSuggestCanonical(candidate, duration) {
  const term = `${candidate.artist} ${candidate.title}`.trim();
  if (!term) return null;

  const response = await axios.get(`https://api.lyrics.ovh/suggest/${encodeURIComponent(term)}`, {
    timeout: 6000,
    headers: REQUEST_HEADERS,
    validateStatus: (status) => status === 200,
  });

  const results = Array.isArray(response.data?.data) ? response.data.data : [];
  const mapped = results.map((item) => ({
    trackName: item.title,
    artistName: item.artist?.name || item.artist?.title || '',
    duration: Number(item.duration || 0),
  }));

  const best = mapped.sort(
    (a, b) => scoreResult(b, candidate, duration) - scoreResult(a, candidate, duration)
  )[0];
  if (!best || !isConfidentResult(best, candidate, MIN_LYRICS_MATCH_SCORE)) return null;

  return {
    title: String(best.trackName || '').trim(),
    artist: String(best.artistName || '').trim(),
    duration: best.duration || duration || null,
  };
}

async function fetchNeteaseLyrics(candidate, duration) {
  const query = `${candidate.artist} ${candidate.title}`.trim();
  if (!query) return null;

  const searchResponse = await axios.get('https://music.163.com/api/search/get', {
    params: { s: query, type: 1, offset: 0, total: true, limit: 8 },
    timeout: 7000,
    headers: {
      ...WEB_HEADERS,
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
    },
    validateStatus: (status) => status === 200,
  });

  const songs = searchResponse.data?.result?.songs || [];
  const mapped = songs.map((song) => ({
    id: song.id,
    trackName: song.name,
    artistName: (song.artists || []).map((artist) => artist.name).filter(Boolean).join(', '),
    duration: Number(song.duration || 0) / 1000,
  }));

  const best = mapped
    .filter((song) => song.id)
    .sort((a, b) => scoreResult(b, candidate, duration) - scoreResult(a, candidate, duration))[0];
  if (!best || !isConfidentResult(best, candidate, MIN_LYRICS_MATCH_SCORE)) return null;

  const lyricResponse = await axios.get('https://music.163.com/api/song/lyric', {
    params: { id: best.id, lv: -1, kv: -1, tv: -1 },
    timeout: 7000,
    headers: {
      ...WEB_HEADERS,
      Referer: 'https://music.163.com/',
    },
    validateStatus: (status) => status === 200,
  });

  if (lyricResponse.data?.nolyric || lyricResponse.data?.uncollected) return null;
  const synced = String(lyricResponse.data?.lrc?.lyric || '').trim();
  if (!hasUsableLrc(synced)) {
    const plain = lrcToPlain(synced);
    return plain ? { synced: null, plain } : null;
  }

  return { synced, plain: lrcToPlain(synced) };
}

async function fetchLyricsOvh(candidate) {
  if (!candidate.title || !candidate.artist) return null;

  const artistVariants = [
    candidate.artist,
    candidate.artist?.split(/,|\s&\s|\s+and\s+/i)[0]?.trim(),
  ].filter((value, index, list) => list.indexOf(value) === index);

  for (const artistName of artistVariants) {
    try {
      const url = `${LYRICS_OVH_BASE}/${encodeURIComponent(artistName || '')}/${encodeURIComponent(candidate.title)}`;
      const response = await axios.get(url, {
        timeout: 7000,
        headers: REQUEST_HEADERS,
        validateStatus: (status) => status === 200 || status === 404,
      });

      if (response.status === 404) continue;
      const plain = response.data?.lyrics;
      if (plain && String(plain).trim()) {
        return { synced: null, plain: String(plain).trim() };
      }
    } catch {
      // try next variant
    }
  }

  return null;
}

function sliceBalancedDivInner(html, openRegex) {
  const blocks = [];
  const opener = new RegExp(openRegex, 'gi');
  const source = String(html || '');
  let match;

  while ((match = opener.exec(source)) !== null) {
    let index = opener.lastIndex;
    let depth = 1;
    const lower = source.toLowerCase();

    while (index < source.length && depth > 0) {
      const nextOpen = lower.indexOf('<div', index);
      const nextClose = lower.indexOf('</div>', index);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        index = nextOpen + 4;
      } else {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(opener.lastIndex, nextClose));
        }
        index = nextClose + 6;
      }
    }
  }

  return blocks;
}

function extractGeniusLyrics(html) {
  const blocks = sliceBalancedDivInner(html, '<div[^>]+data-lyrics-container=["\']true["\'][^>]*>');
  if (!blocks.length) return null;

  const withoutHeaders = blocks.map((block) => {
    const excluded = sliceBalancedDivInner(block, '<div[^>]+data-exclude-from-selection=["\']true["\'][^>]*>');
    let next = block;
    excluded.forEach((inner) => {
      next = next.replace(inner, ' ');
    });
    return next;
  });

  const plain = decodeHtmlEntities(
    withoutHeaders
      .join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/^\s*\d+\s*contributors[\s\S]*?\blyrics\b/im, '')
      .replace(/^\s*contributors[\s\S]*?\blyrics\b/im, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\d*Embed\s*$/i, '')
      .trim()
  );

  return plain.length > 20 ? plain : null;
}

function geniusHitsFromSearch(data) {
  const direct = data?.response?.hits;
  if (Array.isArray(direct) && direct.length) {
    return direct.map((hit) => hit.result).filter((result) => result?.url);
  }

  const sections = data?.response?.sections || [];
  const songSection =
    sections.find((section) => section.type === 'song') ||
    sections.find((section) => (section.hits || []).some((hit) => hit?.result?.url));
  return (songSection?.hits || [])
    .map((hit) => hit.result)
    .filter((result) => result?.url);
}

async function searchGeniusHits(query, geniusToken) {
  if (geniusToken) {
    const searchResponse = await axios.get(GENIUS_API_SEARCH_BASE, {
      params: { q: query },
      timeout: 8000,
      headers: {
        Authorization: `Bearer ${geniusToken}`,
        Accept: 'application/json',
        'User-Agent': GENIUS_API_USER_AGENT,
      },
      validateStatus: (status) => status === 200,
    });
    return geniusHitsFromSearch(searchResponse.data);
  }

  const searchResponse = await axios.get('https://genius.com/api/search/multi', {
    params: { q: query, per_page: 5 },
    timeout: 8000,
    headers: {
      ...WEB_HEADERS,
      Accept: 'application/json',
      Referer: 'https://genius.com/',
    },
    validateStatus: (status) => status === 200,
  });
  return geniusHitsFromSearch(searchResponse.data);
}

async function fetchGeniusLyrics(candidate) {
  const geniusToken = getGeniusAccessToken();
  const queries = [
    `${candidate.artist} ${candidate.title}`.trim(),
    `${String(candidate.artist || '').replace(/\s+/g, '')} ${candidate.title}`.trim(),
  ];
  if (!candidate.artist) {
    queries.push(candidate.title);
  }
  const seen = new Set();

  for (const query of queries) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || seen.has(normalizedQuery.toLowerCase())) continue;
    seen.add(normalizedQuery.toLowerCase());

    try {
      const hits = await searchGeniusHits(normalizedQuery, geniusToken);
      const best = hits.sort(
        (a, b) => scoreResult(b, candidate, null) - scoreResult(a, candidate, null)
      )[0];

      if (!best?.url || !isConfidentResult(best, candidate, MIN_GENIUS_MATCH_SCORE)) continue;

      const pageResponse = await axios.get(best.url, {
        timeout: 9000,
        headers: {
          ...WEB_HEADERS,
          Referer: 'https://genius.com/',
        },
        validateStatus: (status) => status === 200,
      });

      const plain = extractGeniusLyrics(pageResponse.data);
      if (plain) {
        return { synced: null, plain };
      }
    } catch {
      // try next query
    }
  }

  return null;
}

async function resolveLyrics(title, artist, duration) {
  const candidates = buildCandidates(title, artist);
  if (!candidates.length) {
    return { synced: null, plain: null };
  }

  const extraCandidates = candidates.slice(0, 3);
  let plainFallback = null;

  const collect = (results) => {
    const synced = results.find((result) => result?.synced);
    if (synced) return synced;
    if (!plainFallback) {
      plainFallback = results.find((result) => result?.plain) || null;
    }
    return null;
  };

  const lrclibTasks = [];
  candidates.forEach((candidate) => {
    lrclibTasks.push(fetchLrclibGet(candidate, duration).catch(() => null));
    lrclibTasks.push(fetchLrclibGet(candidate, null).catch(() => null));
    lrclibTasks.push(fetchLrclibSearch(candidate, duration).catch(() => null));
  });
  const lrclibSynced = collect(await Promise.all(lrclibTasks));
  if (lrclibSynced) return lrclibSynced;

  const itunesMatches = (
    await Promise.all(
      extraCandidates.flatMap((candidate) => [
        fetchItunesCanonical(candidate, duration).catch(() => null),
        fetchSuggestCanonical(candidate, duration).catch(() => null),
      ])
    )
  ).filter(Boolean);

  if (itunesMatches.length) {
    const retryTasks = [];
    itunesMatches.forEach((match) => {
      retryTasks.push(fetchLrclibGet(match, match.duration).catch(() => null));
      retryTasks.push(fetchLrclibSearch(match, match.duration).catch(() => null));
    });
    const itunesSynced = collect(await Promise.all(retryTasks));
    if (itunesSynced) return itunesSynced;
  }

  const syncedFallbackTasks = [];
  extraCandidates.forEach((candidate) => {
    syncedFallbackTasks.push(fetchNeteaseLyrics(candidate, duration).catch(() => null));
  });
  const syncedFallback = collect(await Promise.all(syncedFallbackTasks));
  if (syncedFallback) return syncedFallback;

  if (!plainFallback) {
    const plainTasks = [];
    extraCandidates.forEach((candidate) => {
      plainTasks.push(fetchLyricsOvh(candidate).catch(() => null));
      plainTasks.push(fetchGeniusLyrics(candidate).catch(() => null));
    });
    const plainSynced = collect(await Promise.all(plainTasks));
    if (plainSynced) return plainSynced;
  }

  return plainFallback || { synced: null, plain: null };
}

module.exports = {
  resolveLyrics,
};
