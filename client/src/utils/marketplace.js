import axios from 'axios';

export async function fetchCatalog(type = '', { shop = false } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (shop) params.set('shop', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await axios.get(`/api/marketplace/catalog${query}`);
  return res.data;
}

export async function fetchInventory() {
  const res = await axios.get('/api/marketplace/inventory');
  return res.data;
}

export async function fetchListings({ type = '', mine = false } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (mine) params.set('mine', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await axios.get(`/api/marketplace/listings${query}`);
  return res.data;
}

export async function buyItem(itemId) {
  const res = await axios.post('/api/marketplace/buy', { itemId });
  return res.data;
}

export async function equipItem(instanceId, customization, options = {}) {
  const body = { instanceId };
  if (customization?.frameColor) body.frameColor = customization.frameColor;
  if (customization?.neonGradient) body.neonGradient = customization.neonGradient;
  if (customization?.nameGradient) body.nameGradient = customization.nameGradient;
  if (options.slot) body.slot = options.slot;
  const res = await axios.post('/api/marketplace/equip', body);
  return res.data;
}

export async function customizeBadgeLabel(instanceId, customLabel) {
  const res = await axios.post(`/api/marketplace/customize/${instanceId}`, { customLabel });
  return res.data;
}

export async function customizeFrame(instanceId, customization = {}) {
  const res = await axios.post(`/api/marketplace/customize/${instanceId}`, customization);
  return res.data;
}

export async function unequipSlot(slot) {
  const res = await axios.post('/api/marketplace/unequip', { slot });
  return res.data;
}

export async function listItem(instanceId, priceCoins) {
  const res = await axios.post('/api/marketplace/list', { instanceId, priceCoins });
  return res.data;
}

export async function unlistItem(instanceId) {
  const res = await axios.delete(`/api/marketplace/list/${instanceId}`);
  return res.data;
}

export async function buyListing(instanceId) {
  const res = await axios.post(`/api/marketplace/buy-listing/${instanceId}`);
  return res.data;
}
