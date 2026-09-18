'use client';

/**
 * Reading the last known state when there is no network.
 *
 * The app used to refuse this outright. The service worker's own comment said API responses were
 * never cached "so the app can never show stale chats", and that was a deliberate choice: a
 * message that is one poll out of date is a message somebody may act on. What changed is the
 * situation, not the principle. With no connection at all, the alternative to a slightly old
 * chat is a blank screen, and a blank screen is not more honest — it is just less useful. So the
 * app now shows what it last knew, says so on screen, and refuses to send.
 *
 * Deliberately in the page rather than in the service worker. The service worker does not run in
 * every context this app runs in — it is skipped on an insecure origin, and the bundled Android
 * build serves the page from a loopback address, where a worker is one more thing that can fail
 * differently on one device than another. A cache kept beside the code that reads it behaves the
 * same everywhere the code does.
 */

/** One key per cached path, plus a single index used to decide what to drop. */
const PREFIX = 'varnox.offline.v1:';
const INDEX_KEY = 'varnox.offline.index.v1';

/**
 * How much of the origin's storage this may use.
 *
 * localStorage gives roughly five megabytes, and going over it throws rather than evicting, so
 * the budget stays well under that. What is being kept is the chat list and the most recently
 * opened conversations — enough to read, which is the whole purpose; nobody needs a year of
 * history to be told they are offline.
 */
const BUDGET_BYTES = 4 * 1024 * 1024;

type IndexEntry = { path: string; at: number; size: number };

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Storage can be absent or throw outright — a browser in a locked-down mode, or a WebView
    // with DOM storage switched off. Not being able to cache is not a reason to fail: every
    // caller treats a miss as a miss, and the app simply behaves as it did before.
    return null;
  }
}

function readIndex(): IndexEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: IndexEntry[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // The index is only for eviction. Losing it makes space accounting wrong for one session,
    // which is survivable; throwing here would break the request that was being served.
  }
}

/** Drops the oldest entries until everything fits inside the budget. */
function evict(entries: IndexEntry[]): IndexEntry[] {
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= BUDGET_BYTES) return entries;

  const store = storage();
  const oldestFirst = [...entries].sort((a, b) => a.at - b.at);
  while (oldestFirst.length > 1 && total > BUDGET_BYTES) {
    const dropped = oldestFirst.shift();
    if (!dropped) break;
    total -= dropped.size;
    try {
      store?.removeItem(PREFIX + dropped.path);
    } catch {
      // Already gone, or storage refused. Either way it is no longer counted.
    }
  }
  return oldestFirst;
}

/** Stores a successful read, keyed by the path it was made from. */
export function cachePut(path: string, value: unknown): void {
  const store = storage();
  if (!store) return;

  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    // Circular or otherwise unserialisable. Nothing to keep.
    return;
  }

  try {
    store.setItem(PREFIX + path, serialised);
  } catch {
    // Over quota even after eviction, or storage is full for some other reason. The read that
    // was being cached succeeded and its caller has the value already, so this is not an error
    // worth surfacing — the cache simply stops growing.
    return;
  }

  const size = serialised.length + path.length;
  const rest = readIndex().filter((entry) => entry.path !== path);
  writeIndex(evict([...rest, { path, at: Date.now(), size }]));
}

/**
 * The stored read for a path, if there is one.
 *
 * Returns a wrapper rather than a bare value because null is a perfectly good thing to have
 * cached — `/api/me` answers with `user: null` when signed out, and treating that as a miss
 * would send the app to the sign-in screen every time it started without a connection.
 */
export function cacheGet<T>(path: string): { hit: true; value: T } | { hit: false } {
  const store = storage();
  if (!store) return { hit: false };
  try {
    const raw = store.getItem(PREFIX + path);
    if (raw === null) return { hit: false };
    return { hit: true, value: JSON.parse(raw) as T };
  } catch {
    // Corrupt entry. Best to forget it than to keep failing on it.
    try {
      store.removeItem(PREFIX + path);
    } catch {
      /* nothing to do */
    }
    return { hit: false };
  }
}

export function cacheClear(): void {
  const store = storage();
  if (!store) return;
  try {
    for (const entry of readIndex()) store.removeItem(PREFIX + entry.path);
    store.removeItem(INDEX_KEY);
  } catch {
    /* nothing to do */
  }
}

// ------------------------------------------------------------------------ network

/**
 * Whether the last request actually reached a server.
 *
 * Asked of the requests themselves rather than of `navigator.onLine`, which reports whether the
 * device is attached to a network, not whether anything is reachable through it. A phone on a
 * captive-portal wifi, or one whose data has quietly stopped working, is "online" by that
 * measure and offline by every measure that matters. A request that fails to leave the device is
 * the only evidence that is true when it is observed.
 */
let unreachable = false;
const listeners = new Set<(offline: boolean) => void>();

function announce(): void {
  const offline = isOffline();
  for (const listener of listeners) {
    try {
      listener(offline);
    } catch {
      // A listener that throws is its own problem, and not one to break the others over.
    }
  }
}

export function markNetworkDown(): void {
  if (unreachable) return;
  unreachable = true;
  announce();
}

export function markNetworkUp(): void {
  if (!unreachable) return;
  unreachable = false;
  announce();
}

/** True when a request has just failed to leave the device, or the device says it is offline. */
export function isOffline(): boolean {
  if (unreachable) return true;
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Watches for the connection coming and going.
 *
 * The browser events are part of it, but they are not enough on their own: they say when the
 * radio changes, not when the server becomes reachable again. Recovery is also noticed by the
 * next successful request, which is why {@link markNetworkUp} announces too.
 */
export function subscribeNetwork(listener: (offline: boolean) => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('online', markNetworkUp);
    window.addEventListener('offline', announce);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('online', markNetworkUp);
      window.removeEventListener('offline', announce);
    }
  };
}

/**
 * Thrown instead of a generic failure when the request never reached a server.
 *
 * A distinct type so callers can tell "the network is gone" from "the server said no" — the
 * first is worth wording differently on screen, and is the only one that might be worth
 * retrying on its own.
 */
export class OfflineError extends Error {
  constructor(message = "You're offline. You can read what you have, but this needs a connection.") {
    super(message);
    this.name = 'OfflineError';
  }
}
