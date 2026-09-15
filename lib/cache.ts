/**
 * Tiny in-process cache.
 *
 * This existed to cut Vercel Blob reads, which were the scarce resource. Postgres makes
 * reads cheap, but the client polls the chats list every 3.5 seconds, so deduping those
 * within a warm serverless instance is still worth it. Serverless instances are reused,
 * so a few seconds of TTL removes most of the repeat traffic.
 */
type CacheEntry = { at: number; value: unknown };

const cache = new Map<string, CacheEntry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: now, value });
  if (cache.size > 400) {
    for (const [k, v] of cache) if (now - v.at > 60_000) cache.delete(k);
  }
  return value;
}

export function invalidate(prefixKey: string) {
  for (const k of cache.keys()) if (k.startsWith(prefixKey)) cache.delete(k);
}
