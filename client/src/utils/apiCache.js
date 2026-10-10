const MAX_ENTRIES = 48;
const cache = new Map();
const inflight = new Map();

function trimCache() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function cacheSet(key, entry) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  trimCache();
}

export async function cachedRequest(request, key, ttlMs = 120000) {
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && hit.expires > now) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.data;
  }

  if (hit) cache.delete(key);

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = request()
    .then((data) => {
      cacheSet(key, { data, expires: Date.now() + ttlMs });
      inflight.delete(key);
      return data;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });

  inflight.set(key, promise);
  return promise;
}

export function prefetchRequest(request, key, ttlMs = 120000) {
  cachedRequest(request, key, ttlMs).catch(() => {});
}

export function clearApiCache() {
  cache.clear();
  inflight.clear();
}
