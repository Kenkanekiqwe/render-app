import axios from 'axios';

export async function fetchAdminUsers(query = '') {
  const q = query.trim();
  const res = await axios.get(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return res.data.users;
}

export async function fetchAdminUser(userId) {
  const res = await axios.get(`/api/admin/users/${userId}`);
  return res.data;
}

export async function fetchAdminCatalog() {
  const res = await axios.get('/api/admin/catalog');
  return res.data;
}

export async function banUser(userId, reason = '') {
  const res = await axios.post(`/api/admin/users/${userId}/ban`, { reason });
  return res.data;
}

export async function unbanUser(userId) {
  const res = await axios.post(`/api/admin/users/${userId}/unban`);
  return res.data;
}

export async function deleteUser(userId) {
  const res = await axios.delete(`/api/admin/users/${userId}`);
  return res.data;
}

export async function adjustUserCoins(userId, amount, mode = 'add') {
  const res = await axios.post(`/api/admin/users/${userId}/coins`, { amount, mode });
  return res.data;
}

export async function grantUserItem(userId, itemId) {
  const res = await axios.post(`/api/admin/users/${userId}/grant-item`, { itemId });
  return res.data;
}

export async function revokeUserItem(userId, instanceId) {
  const res = await axios.delete(`/api/admin/users/${userId}/items/${instanceId}`);
  return res.data;
}

export async function grantAdmin(userId) {
  const res = await axios.post(`/api/admin/users/${userId}/admin`);
  return res.data;
}

export async function revokeAdmin(userId) {
  const res = await axios.delete(`/api/admin/users/${userId}/admin`);
  return res.data;
}

export async function fetchPendingBadgeLabels() {
  const res = await axios.get('/api/admin/badge-labels/pending');
  return res.data.items;
}

export async function moderateBadgeLabel(instanceId, action) {
  const res = await axios.post(`/api/admin/badge-labels/${instanceId}/moderate`, { action });
  return res.data;
}
