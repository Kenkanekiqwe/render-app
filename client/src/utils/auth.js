import axios from 'axios';

const TOKEN_KEY = 'render_auth_token';
const USER_KEY = 'render_auth_user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore storage failures
  }
  applyAuthHeader();
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
  applyAuthHeader();
}

/** Keep the Authorization header in sync with the stored token. */
export function applyAuthHeader() {
  const token = getToken();
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

export async function fetchCaptcha() {
  const res = await axios.get('/api/auth/captcha');
  return res.data;
}

export async function register(payload) {
  const res = await axios.post('/api/auth/register', payload);
  setSession(res.data.token, res.data.user);
  return res.data.user;
}

export async function login(payload) {
  const res = await axios.post('/api/auth/login', payload);
  setSession(res.data.token, res.data.user);
  return res.data.user;
}

export async function fetchMe() {
  const res = await axios.get('/api/auth/me');
  return res.data.user;
}

export async function updateProfile(payload) {
  const res = await axios.put('/api/auth/profile', payload);
  setSession(getToken(), res.data.user);
  return res.data.user;
}

export async function updatePrivacy(payload) {
  const res = await axios.put('/api/auth/privacy', payload);
  setSession(getToken(), res.data.user);
  return res.data.user;
}

export async function fetchMyPlaylists() {
  const res = await axios.get('/api/auth/playlists');
  return res.data.playlists || [];
}

export async function syncPlaylists(playlists) {
  const res = await axios.put('/api/auth/playlists', { playlists });
  return res.data.playlists || [];
}

export async function fetchUserProfile(userId) {
  const res = await axios.get(`/api/users/${userId}/profile`);
  return res.data;
}

export async function fetchFriendPlaylist(userId, playlistId) {
  const res = await axios.get(
    `/api/users/${userId}/playlists/${encodeURIComponent(playlistId)}`
  );
  return res.data;
}

export async function syncNowPlaying(track, isPlaying) {
  await axios.post('/api/auth/now-playing', {
    track: track || null,
    isPlaying: Boolean(isPlaying),
  });
}

export function extractAuthError(error) {
  return {
    message: error?.response?.data?.error || 'Что-то пошло не так. Попробуйте ещё раз.',
    field: error?.response?.data?.field || null,
    status: error?.response?.status || 0,
  };
}
