import { streamDownloadUrl, streamInfoUrl, streamPlayUrl } from './streamPlayback';


const DB_NAME = 'render-offline';
const DB_VERSION = 1;
const STORE = 'tracks';
const MAX_TRACKS = 24;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb'));
  });
}

function storeRequest(store, method, value) {
  return new Promise((resolve, reject) => {
    const request = store[method](value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isOfflineCacheAvailable() {
  return typeof indexedDB !== 'undefined';
}

export async function getCachedTrack(trackId) {
  const id = String(trackId || '');
  if (!id) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await storeRequest(tx.objectStore(STORE), 'get', id);
    return row?.blob instanceof Blob ? row : null;
  } finally {
    db.close();
  }
}

export async function listCachedTracks() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const rows = await storeRequest(tx.objectStore(STORE), 'getAll');
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        id: row.id,
        track: row.track,
        savedAt: row.savedAt,
        bytes: row.blob?.size || 0,
      }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } finally {
    db.close();
  }
}

async function evictOldest(db, keepId) {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rows = await storeRequest(store, 'getAll');
  const extra = (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row.id) !== String(keepId))
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  while (extra.length >= MAX_TRACKS) {
    const oldest = extra.shift();
    if (oldest?.id) await storeRequest(store, 'delete', oldest.id);
  }
}

export async function saveTrackOffline(track) {
  const id = String(track?.id || '');
  if (!id) throw new Error('track');

  const infoRes = await fetch(`/api/stream/${id}/info`);
  if (!infoRes.ok) throw new Error('stream');
  const info = await infoRes.json();
  if (info.protocol === 'hls') throw new Error('hls');

  const url = info.url || info.rewriteUrl;
  if (!url) throw new Error('stream');

  const mediaRes = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!mediaRes.ok) throw new Error('download');
  const blob = await mediaRes.blob();
  if (!blob.size) throw new Error('empty');

  const db = await openDb();
  try {
    await evictOldest(db, id);
    const tx = db.transaction(STORE, 'readwrite');
    await storeRequest(tx.objectStore(STORE), 'put', {
      id,
      track: {
        id: track.id,
        title: track.title || '',
        artist: track.artist || '',
        cover: track.cover || '',
        duration: Number(track.duration) || 0,
      },
      blob,
      savedAt: Date.now(),
    });
  } finally {
    db.close();
  }
}

export async function removeCachedTrack(trackId) {
  const id = String(trackId || '');
  if (!id) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await storeRequest(tx.objectStore(STORE), 'delete', id);
  } finally {
    db.close();
  }
}

export async function hasCachedTrack(trackId) {
  const row = await getCachedTrack(trackId);
  return Boolean(row);
}
function slimTrack(track) {
  return {
    id: track?.id,
    title: track?.title || '',
    artist: track?.artist || '',
    cover: track?.cover || '',
    duration: Number(track?.duration) || 0,
  };
}

export async function saveBlobOffline(track, blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('empty');
  const id = String(track?.id || '');
  if (!id) throw new Error('track');
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existing = await storeRequest(store, 'getAll');
    const rows = Array.isArray(existing) ? existing : [];
    if (rows.length >= MAX_TRACKS && !rows.some((row) => String(row.id) === id)) {
      const oldest = rows.slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))[0];
      if (oldest?.id != null) await storeRequest(store, 'delete', oldest.id);
    }
    await storeRequest(store, 'put', {
      id,
      track: slimTrack(track),
      blob,
      savedAt: Date.now(),
    });
  } finally {
    db.close();
  }
}

function fetchOptions(signal) {
  return { credentials: 'same-origin', signal };
}

async function readBlobWithProgress(response, onProgress, signal) {
  if (!response.ok) throw new Error('download');
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) {
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty');
    onProgress?.(1);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength || value.length || 0;
    if (total > 0) onProgress?.(Math.min(0.99, received / total));
  }
  onProgress?.(1);
  const type = response.headers.get('content-type') || 'audio/mpeg';
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('empty');
  return blob;
}

async function fetchTrackBlob(track, { onProgress, signal } = {}) {
  const id = String(track?.id || '');
  if (!id) throw new Error('track');
  try {
    const response = await fetch(streamDownloadUrl(id), fetchOptions(signal));
    if (response.ok) return await readBlobWithProgress(response, onProgress, signal);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }
  const infoRes = await fetch(streamInfoUrl(id), fetchOptions(signal));
  if (!infoRes.ok) throw new Error('stream');
  const info = await infoRes.json();
  if (info.protocol === 'hls') {
    const playlistUrl = streamPlayUrl(id, { hls: true });
    const playlistRes = await fetch(playlistUrl, fetchOptions(signal));
    if (!playlistRes.ok) throw new Error('hls');
    throw new Error('hls-download-unsupported');
  }
  const response = await fetch(streamPlayUrl(id), fetchOptions(signal));
  return readBlobWithProgress(response, onProgress, signal);
}

export function sanitizeDownloadName(value, fallback = 'track') {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 120);
}

export function buildTrackFilename(track, extension = 'mp3') {
  return `${sanitizeDownloadName(track?.artist, 'Unknown')} - ${sanitizeDownloadName(track?.title, 'track')}.${extension}`;
}

export function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'track.mp3';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadTrack(track, { onProgress, cache = true, saveFile = true, signal } = {}) {
  const blob = await fetchTrackBlob(track, { onProgress, signal });
  if (saveFile) {
    const mime = blob.type || '';
    const extension = /mp4|m4a|aac/i.test(mime) ? 'm4a' : 'mp3';
    triggerFileDownload(blob, buildTrackFilename(track, extension));
  }
  if (cache) {
    try { await saveBlobOffline(track, blob); } catch { /* ignore */ }
  }
  return blob;
}
