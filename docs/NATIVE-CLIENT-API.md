# The API a native Varnox client needs

A proposal for `/api/v1`, written against the code as it exists on 2026-09-18.

The web app has **96 routes**. This document specifies the subset a native client needs, the
changes in kind that mobile forces, and the order to build it in.

---

## 1. Why a new namespace rather than the existing routes

Not preference — necessity. Every current route reads a cookie:

```
lib/auth.ts:59   const jar = await cookies();
lib/auth.ts:70   const jar = await cookies();
...  5 more call sites
```

A native client has no cookie jar, so the options are to fake one (fragile, and it breaks the
moment you touch session handling) or to have routes that authenticate from a header. **`/api/v1`
already does the second one** — it authenticates with `Authorization: Bearer` — so the precedent
and the helper (`authenticateRequest`) exist. The work is extending the pattern, not inventing it.

The v1 routes are deliberately thin: they authenticate, validate, and call the same `lib/`
functions the web routes call. Nothing about the database or the business rules changes. That is
what makes a native client affordable rather than a rewrite of the product.

## 2. Auth

Cookie sessions are wrong for a phone. A mobile app is resumed after hours or days, and a
60-day session cookie that a WebView cannot hold is not a substitute.

```
POST /api/v1/auth/login
     { "identifier": "<phone|email|username>", "password": "…" }
     -> { accessToken, refreshToken, expiresIn, user }

POST /api/v1/auth/refresh
     { "refreshToken": "…" }
     -> { accessToken, refreshToken, expiresIn }        refresh tokens rotate

POST /api/v1/auth/logout
     { "refreshToken": "…" }                            revokes this device only

POST /api/v1/auth/code/start     { "email": "…" }        the registration + reset flows
POST /api/v1/auth/code/verify    { "email": "…", "code": "…" }
POST /api/v1/auth/register       { phone, email, username, password, code }
POST /api/v1/auth/reset          { email, phone, code, password }
```

**Design notes, each of which will bite if ignored:**

- **Short access token, rotating refresh token.** An access token on a phone is on a device that
  gets lost. Hours, not months.
- **One revocation path.** The existing `vx_devices` rows already model "a signed-in client".
  A native install is one of those rows, so "sign out my other devices" keeps working and admin
  tooling keeps working. Do not invent a parallel session store.
- **The refusal stays one sentence**, as `/api/v1` does today. A native client must not be able to
  tell a wrong password from a missing account any more than a bot can.

## 3. Messaging

```
GET  /api/v1/chats                              list, with unread counts and last message
GET  /api/v1/chats/{id}/messages?before=&limit= history, newest first, CURSOR not offset
POST /api/v1/chats/{id}/messages                { body, clientId, replyTo?, mediaIds? }
GET  /api/v1/sync?since=<timestamp>             everything changed since a moment
POST /api/v1/chats/{id}/read                    { upTo: <messageId> }
POST /api/v1/chats/{id}/typing
POST /api/v1/messages/{id}/react                { emoji }
POST /api/v1/messages/{id}/star
GET  /api/v1/starred
GET  /api/v1/search?q=
```

**Three details that are the difference between a client that works and one that corrupts data:**

**Cursors, not offsets.** A chat inserts at the top while you scroll, so `offset=40` returns
different messages a moment later — duplicates and skips. A cursor is a position in a conversation
that means the same thing on the next request. The existing `hasMore` / `loadOlder` shape in
`lib/db.ts` is already cursor-like; the client API should expose it as such.

**`clientId` for every send — idempotency.** A phone on a train retries. Without a client-supplied
id, the retry posts the message twice and the user sees their own message duplicated. The server
stores the `clientId` and returns the same message for a repeat. This is the single most important
field in this document; it is invisible until the first bad network, and then it is a data-quality
bug in everyone's chat history.

**`/sync?since=` for incremental catch-up.** A native client caches locally — it has to, or it
spins on open. On resume it needs "what changed since I last synced", not a full refetch of every
chat. Cheap to add now, very hard to retrofit once clients hold local state.

## 4. Media

```
POST /api/v1/media/upload       multipart, or a presigned target
GET  /api/v1/media/{id}         with range support
```

Reuse the existing `/upload` machinery rather than adding a second path. Two things differ for
mobile and both matter:

- **Resumable or at least retryable.** A 20MB video on 3G will fail partway. A client that must
  restart from zero makes the app feel broken.
- **Skips re-upload by content hash.** A phone re-sends the same photo from the camera roll
  constantly; the hash lets the server answer "already have it" instead of moving bytes twice.

## 5. Real-time — keep the house style

The existing code answers this question twice already: `/v1/inbox?wait=` long-polls and
`/calls/{id}/signals` is a poll loop. **Keep it.**

```
GET /api/v1/chats/{id}/stream?since=      long poll, holds until something or ~25s
GET /api/v1/calls/{id}/signals?since=     the signalling loop
GET /api/v1/presence                      heartbeat in, roster out
```

Long polling over sockets is a deliberate trade: it goes through every proxy, corporate firewall
and mobile network unchanged, it needs no sticky sessions on serverless, and it degrades to a
slower client rather than a dead one. A socket adds a second deployment concern to every host you
will ever run on. For a chat app at this scale the poll is the better engineering, not the lazy one.

## 6. Push

```
POST /api/v1/devices/register    { platform: 'android'|'ios', pushToken, appVersion }
POST /api/v1/devices/unregister  { pushToken }
```

Ties into the `vx_devices` row from section 2, so a push token is a property of a session rather
than a separate table to keep in step. **This is the one thing the PWA genuinely cannot do well**,
and the strongest reason for the whole client.

## 7. Scale, honestly

Of the 96 routes, a feature-complete native client needs roughly:

| Group | Endpoints | Notes |
|---|---|---|
| Auth | ~6 | New — token-based |
| Chats + messages | ~12 | Mostly adapters over existing libs |
| Media | ~2 | Reuse `/upload` |
| Profile, settings, presence | ~5 | Adapters |
| Push | ~2 | New |
| Status, channels | ~10 | Straight adapters |
| **Calls (WebRTC)** | ~8 | **New native module — the hard part** |
| Moderation, admin, bots, WhatsApp | ~45 | Web-facing. Not needed on a phone |

**Calls are where this project will stall if it is attempted early.** WebRTC in React Native means
`react-native-webrtc`, a native module, background handling, and audio session management on both
platforms. It is the single largest and least forgiving piece, and it is worth building last — a
text-and-photo client that ships beats a half-working client with calls.

## 8. Build order

Each stage is independently usable, which is the point of ordering it this way.

1. **Auth + `/me` + chats + messages.** A working text client. If the project stops here, you still
   shipped something people can use.
2. **Media, reactions, read receipts, typing.** Feels like a real messenger.
3. **Sync + local cache.** Makes it fast, and is much cheaper before clients hold data than after.
4. **Push.** The reason a native app beats the PWA.
5. **Status and channels.** Adapters; low risk.
6. **Calls.** Last, and only if the rest is solid.

## 9. What does not change

The database, the business rules, the throttles, the suspension ladder, the moderation tooling —
all of it stays. A native client is a second door into the same house. The only thing being written
twice is the interface, and the `/api/v1` namespace is what keeps even that from being a rewrite.
