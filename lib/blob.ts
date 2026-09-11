import { list, put, type ListBlobResultBlob } from '@vercel/blob';

/**
 * Low-level storage helpers.
 *
 * Storage is Vercel Blob. IMPORTANT design constraint discovered by probing the
 * live store: a blob written to a *new* pathname is immediately readable and
 * immediately visible to list(), but an OVERWRITTEN pathname keeps serving the
 * old bytes from the CDN cache for up to 60s (cache-busting query strings do not
 * help). So nothing in this app ever overwrites a path. Every mutation writes a
 * new, uniquely named version whose name sorts newest-first; readers take the
 * newest version for a prefix.
 */

export const ROOT = 'vx';

/** Reverse-sortable timestamp: newest version sorts first lexicographically. */
export function versionKey(at: number = Date.now()): string {
  const inv = 9_999_999_999_999 - at;
  return String(inv).padStart(13, '0') + '-' + rand(6);
}

export function rand(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + rand(7);
}

export async function listPrefix(prefix: string, limit = 50, cursor?: string) {
  const res = await list({ prefix, limit, cursor });
  return res;
}

/** Read a JSON document from a blob URL. Versioned paths are immutable, so the CDN is safe. */
export async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function putJson(pathname: string, value: unknown): Promise<string> {
  const res = await put(pathname, JSON.stringify(value), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    // Every caller passes a versionKey()-suffixed path, so a repeat write can only
    // mean a genuine bug. Refusing the overwrite turns a silent stale read into a
    // loud error, which is what this design depends on.
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
  return res.url;
}

export async function putBinary(
  pathname: string,
  body: ArrayBuffer | Blob | Buffer,
  contentType: string
): Promise<string> {
  const res = await put(pathname, body as never, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
    allowOverwrite: false,
    cacheControlMaxAge: 31536000,
  });
  return res.url;
}

/**
 * Fetch the newest JSON document stored under a versioned prefix
 * (`prefix/<versionKey>.json`). Returns null when nothing is stored yet.
 */
export async function newestJson<T>(prefix: string): Promise<T | null> {
  const { blobs } = await listPrefix(withSlash(prefix), 1);
  const first = sortNewest(blobs)[0];
  if (!first) return null;
  return readJson<T>(first.url);
}

/** List every blob under a prefix, following cursors up to `maxPages`. */
export async function listAll(prefix: string, maxPages = 3, pageSize = 1000) {
  const out: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await listPrefix(withSlash(prefix), pageSize, cursor);
    out.push(...res.blobs);
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

export function sortNewest(blobs: ListBlobResultBlob[]): ListBlobResultBlob[] {
  return [...blobs].sort((a, b) => a.pathname.localeCompare(b.pathname));
}

function withSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : prefix + '/';
}

/** Tiny in-process cache. Serverless instances are reused, so this removes most read traffic. */
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
