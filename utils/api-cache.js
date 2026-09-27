// Shared short-TTL in-process cache for expensive API payloads.
// Cuts repeated PostgREST storms from the dashboard within one Node process.

const store = new Map();

export function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) {
    return Promise.resolve(hit.data);
  }
  return Promise.resolve()
    .then(loader)
    .then((data) => {
      store.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      if (hit) return hit.data;
      throw err;
    });
}
