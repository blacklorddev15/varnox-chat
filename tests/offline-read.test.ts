import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reading offline.
 *
 * The app now shows the last thing it read when it cannot reach the server. The cases worth
 * guarding are the ones where showing that copy would be wrong rather than merely old — a
 * refused sign-in, a missing chat — because those are silent: nothing looks broken, the app
 * simply presents a stale screen as though it were current.
 *
 * The runner has no browser, so a storage and a `window` are supplied below. That is not a
 * simulation of a browser, and it is not meant to be: what is under test is which path through
 * `api()` a given failure takes, not localStorage.
 */

/** How many times anything was written, to catch writes that changed nothing. */
let writes = 0;

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      writes += 1;
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  } as Storage;
}

/** Just enough of a Response for `api()` — it only reads ok, status and json(). */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

let api: Api;
let store: Storage;
let offline: typeof import('@/lib/offline');

async function loadClient(): Promise<void> {
  // Fresh module per test: the offline flag is module state, and one test's failure must not
  // decide the next one's starting point.
  vi.resetModules();
  writes = 0;
  store = fakeStorage();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: store,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  ({ api } = (await import('@/lib/client')) as unknown as { api: Api });
  // The same module instance client.ts holds, because it imports the same file.
  offline = await import('@/lib/offline');
}

beforeEach(async () => {
  await loadClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('reading the last known state', () => {
  it('serves the previous answer when the request cannot leave the device', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [{ id: 'a' }] })));
    await api('/api/chats');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(api('/api/chats')).resolves.toEqual({ chats: [{ id: 'a' }] });
  });

  it('serves the previous answer when the server fails, which is how offline looks in the app', async () => {
    // Inside the bundled Android build the page is served from a loopback address, so an
    // unreachable backend arrives as a 502 from the local proxy rather than as a thrown fetch.
    // If this branch did not exist, the same situation would show a chat in a browser and a
    // blank screen in the app.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [{ id: 'a' }] })));
    await api('/api/chats');

    vi.stubGlobal('fetch', vi.fn(async () => reply(502, { error: 'upstream unreachable' })));
    await expect(api('/api/chats')).resolves.toEqual({ chats: [{ id: 'a' }] });
  });

  it('says so when it answers from the cache because the server failed', async () => {
    // Answering from the cache silently is worse than showing nothing at all: the app would
    // present an old chat as the current one with no reason to think otherwise, so the banner
    // has to come up in this path too — and go away again the moment the backend answers.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [] })));
    await api('/api/chats');
    expect(offline.isOffline()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: 'unavailable' })));
    await api('/api/chats');
    expect(offline.isOffline()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [] })));
    await api('/api/chats');
    expect(offline.isOffline()).toBe(false);
  });

  it('does not answer a refusal with an old copy', async () => {
    // A 401 is the server saying who you are is no longer good. Replaying the last successful
    // read would keep a signed-out session on screen, and it would look completely normal.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { user: { id: 'me' } })));
    await api('/api/me');

    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Not signed in' })));
    await expect(api('/api/me')).rejects.toThrow('Not signed in');
  });

  it('does not answer a 404 with an old copy either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { messages: [] })));
    await api('/api/chats/gone/messages');

    vi.stubGlobal('fetch', vi.fn(async () => reply(404, { error: 'No such chat' })));
    await expect(api('/api/chats/gone/messages')).rejects.toThrow('No such chat');
  });

  it('reports being offline when there is nothing kept to show', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(api('/api/chats')).rejects.toMatchObject({ name: 'OfflineError' });
  });

  it('keeps a null answer rather than reading it as nothing kept', async () => {
    // `/api/me` answers `user: null` when signed out. Treating that as a miss would send the
    // app to the sign-in screen every time it opened without a connection.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { user: null, suspension: null })));
    await api('/api/me');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(api('/api/me')).resolves.toEqual({ user: null, suspension: null });
  });

  it('does not keep a write', async () => {
    // A stale copy of a write is worse than none: the composer would look as though a refused
    // message had been sent.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { message: { id: 'm1' } })));
    await api('/api/chats/a/messages', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(
      api('/api/chats/a/messages', { method: 'POST', body: JSON.stringify({ text: 'hello' }) })
    ).rejects.toMatchObject({ name: 'OfflineError' });
  });

  it('refuses a write while offline instead of queueing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    // Sending is refused, not deferred. A message written now and delivered later would land in
    // an order nobody could have anticipated, which is a worse failure than being told to wait.
    await expect(api('/api/chats/a/messages', { method: 'POST', body: '{}' })).rejects.toThrow(
      /offline/i
    );
  });

  it('gives up the oldest entries before it stops keeping new ones', async () => {
    const chunk = 'x'.repeat(1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { blob: chunk })));
    for (const path of ['/api/one', '/api/two', '/api/three', '/api/four', '/api/five']) {
      await api(path);
    }

    const index = JSON.parse(store.getItem('varnox.offline.index.v1') ?? '[]') as unknown[];
    expect(index.length).toBeLessThan(5);

    // The newest survived; the oldest did not.
    expect(store.getItem('varnox.offline.v1:/api/five')).not.toBeNull();
    expect(store.getItem('varnox.offline.v1:/api/one')).toBeNull();
  });

  it('works with no storage at all', async () => {
    // A WebView with DOM storage switched off, or a browser in a locked-down mode. Not being
    // able to keep a copy must not break the request that would have succeeded.
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [] })));
    await expect(api('/api/chats')).resolves.toEqual({ chats: [] });
  });
});

describe('what must never be kept', () => {
  it('does not keep the signalling poll, which is the one that used to fill the cache', async () => {
    // The bug this guards. Every ICE candidate moves `after` on, so each poll was a different
    // path and therefore a different key: one call wrote dozens of entries and evicted the
    // conversations somebody actually wanted to read, while writing to storage on the main
    // thread every second the call lasted.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { signals: [{ seq: 1 }] })));
    for (const seq of [0, 1, 2, 3, 4, 5]) {
      await api(`/api/calls/abc/signals?after=${seq}`);
    }
    expect(store.getItem('varnox.offline.index.v1')).toBeNull();
  });

  it('does not keep a live call, presence or a typing indicator', async () => {
    // A call that has ended is over. Serving a remembered /api/calls/active would put a call
    // screen back on a phone for a conversation that finished, and its hang-up button would do
    // nothing at all.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { ok: true })));
    await api('/api/calls/active');
    await api('/api/presence');
    await api('/api/chats/a/typing');
    expect(store.getItem('varnox.offline.index.v1')).toBeNull();
  });

  it('still keeps everything that is a snapshot rather than a cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { messages: [] })));
    await api('/api/chats/a/messages?limit=45');
    expect(store.getItem('varnox.offline.v1:/api/chats/a/messages?limit=45')).not.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [] })));
    await api('/api/chats');
    expect(store.getItem('varnox.offline.v1:/api/chats')).not.toBeNull();
  });

  it('does not write an answer that has not changed', async () => {
    // The chats list is polled every few seconds and is usually identical. Writing it anyway
    // costs a synchronous write four times a minute for no change at all, which is the kind of
    // stutter that is very hard to trace back to a cache nobody thinks is doing anything.
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [{ id: 'a' }] })));
    await api('/api/chats');
    const after = writes;
    expect(after).toBeGreaterThan(0);

    await api('/api/chats');
    await api('/api/chats');
    expect(writes).toBe(after);
  });

  it('writes again once the answer does change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [{ id: 'a' }] })));
    await api('/api/chats');
    const after = writes;

    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { chats: [{ id: 'a' }, { id: 'b' }] })));
    await api('/api/chats');
    expect(writes).toBeGreaterThan(after);
  });
});
