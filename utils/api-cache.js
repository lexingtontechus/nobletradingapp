// Shared short-TTL in-process cache for expensive API payloads.
// Cuts repeated PostgREST storms from the dashboard within one Node process.
// Concurrent misses coalesce onto one in-flight loader so N parallel page
// loads don't all stampede the database.

const store = new Map();
const inflight = new Map();

export function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) {
    return Promise.resolve(hit.data);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = Promise.resolve()
    .then(loader)
    .then((data) => {
      store.set(key, { at: Date.now(), data });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      if (hit) return hit.data;
      throw err;
    });

  inflight.set(key, p);
  return p;
}

export function cachePeek(key) {
  return store.get(key)?.data ?? null;
}
