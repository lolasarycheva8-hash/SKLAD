// Tiny in-memory TTL cache for hot read endpoints. Per-instance only (autoscale
// runs several instances, each caches independently) — that's fine: a short TTL
// bounds staleness while cutting repeated heavy DB aggregations under load.
type Entry<T> = { value: T; expiresAt: number };

// Hard cap on distinct keys. Keys can include user-controlled input (e.g. the
// dashboard `month`), so without a bound a client could grow the map without
// limit (memory-DoS). When full we evict expired entries first, then the oldest.
const MAX_ENTRIES = 500;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Still full after dropping expired: evict oldest-inserted keys.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }
  if (hit) {
    // Expired: drop it so the map doesn't keep stale entries around.
    store.delete(key);
  }

  // Collapse concurrent misses for the same key into one DB call (stampede guard).
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await compute();
      evictIfNeeded();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise as Promise<T>;
}

// Drop cache entries so the next read recomputes. Pass a prefix to clear a group
// (e.g. "dashboard:") after a mutation that would make those reads stale.
export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
