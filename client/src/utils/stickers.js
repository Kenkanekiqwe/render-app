import axios from 'axios';

export async function fetchStickerPacks() {
  const res = await axios.get('/api/stickers/packs');
  return res.data;
}

export async function fetchMyStickerPacks() {
  const res = await axios.get('/api/stickers/my');
  return res.data;
}

export async function fetchStickerPack(packId) {
  const res = await axios.get(`/api/stickers/packs/${packId}`);
  return res.data;
}

export async function createStickerPack(name) {
  const res = await axios.post('/api/stickers/packs', { name });
  return res.data;
}

export async function addStickerToPack(packId, { file, imageUrl, label } = {}) {
  if (file) {
    const form = new FormData();
    form.append('image', file);
    if (label) form.append('label', label);
    const res = await axios.post(`/api/stickers/packs/${packId}/stickers`, form);
    return res.data;
  }
  const res = await axios.post(`/api/stickers/packs/${packId}/stickers`, { imageUrl, label });
  return res.data;
}

export async function addPackToCollection(packId) {
  const res = await axios.post(`/api/stickers/packs/${packId}/add`);
  return res.data;
}

export async function removePackFromCollection(packId) {
  const res = await axios.delete(`/api/stickers/packs/${packId}/remove`);
  return res.data;
}

export async function sendChatMessage(payload, { dmUserId } = {}) {
  if (dmUserId) {
    const res = await axios.post('/api/chat/dm', { ...payload, userId: dmUserId });
    return res.data;
  }
  const res = await axios.post('/api/chat/messages', payload);
  return res.data;
}
