# Varnox

A messenger web app: one-to-one chats and group conversations, photo sharing, replies,
message editing and deletion, read receipts and unread badges, in a two-pane layout that
works on desktop and phone. Installable as a PWA.

Live: https://varnox-chat.vercel.app

## Features

- **Accounts** — register and sign in with a username and password. Passwords are hashed with
  scrypt (per-user salt); the session is an HMAC-signed, HttpOnly, SameSite=Lax cookie.
- **1:1 chats** — find people by username, start a chat, message back and forth.
- **Groups** — create a group with a name and members, group photo, admin roles, add and
  remove members, leave the group. A system message records group creation.
- **Messaging** — text, emoji picker, photo attachments (compressed in the browser before
  upload), reply-to, edit and delete your own messages, day separators, message grouping.
- **Status** — unread badges, last-message previews, tick states: one tick sent, two ticks
  delivered, blue ticks read.
- **Interface** — light and dark themes, remembered per device; responsive; installable.

## Architecture

Next.js (App Router) hosted on Vercel, with **Vercel Blob as the datastore** — no separate
database is required.

### Why storage is append-only

Vercel Blob serves public blobs through a CDN. Probing the live store showed that:

| Operation | Result |
| --- | --- |
| Write a **new** pathname, then read it immediately | fresh content |
| Write a **new** pathname, then `list()` immediately | visible immediately |
| **Overwrite** an existing pathname, then read it | **stale content for up to 60s** (cache-busting query strings do not help) |

A messenger read path cannot tolerate a minute of staleness, so nothing in Varnox overwrites a
path. Every mutation writes a **new version** whose name sorts newest-first:

```
vx/u/<userId>/<inverted-ms>-<rand>.json      user profile versions
vx/n/<username>/<version>.json               username -> userId index
vx/c/<convId>/<version>.json                 conversation versions
vx/m/<convId>/<inverted-ms>-<sender>-<id>.json   one blob per message
vx/mo/<convId>/<msgId>/<version>.json        edit / delete operations
vx/uc/<userId>/<convId>/<version>.json       per-user chat index entry
vx/ur/<userId>/<version>.json                per-user read map
vx/r/<convId>/<userId>/<version>.json        read receipt
vx/media/<rand>.<ext>                        uploaded photos
```

`<inverted-ms>` is `9999999999999 - timestamp` zero-padded, so lexicographic order equals
newest-first. Readers take the newest version under a prefix (`list()` with `limit: 1`) or fold
a full listing down to the newest entry per entity. `allowOverwrite` is disabled, so a repeated
pathname fails loudly instead of silently serving stale bytes.

### Other notes

- **Realtime is polling.** Vercel serverless functions cannot hold WebSocket connections. The
  open conversation is polled every 2s using `?since=<timestamp>` so only new messages cross
  the wire; the chat list refreshes every 3.5s. Polling pauses when the tab is hidden.
- **Reads are cheap.** Blob URLs are deterministic, and short-lived in-process caches absorb
  repeated reads on warm function instances.
- **Media** is uploaded directly from the browser to Blob via `POST /api/upload` after
  client-side downscaling (max 1600px, JPEG q0.82, 6 MB limit).
- **Ticks** derive from per-conversation read receipts: two ticks means every other member has
  been online since the message was sent, blue ticks means they have read past it.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in BLOB_READ_WRITE_TOKEN and SESSION_SECRET
npm run dev                  # http://localhost:3000
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | yes | Read/write access to the Vercel Blob store (set automatically when the store is connected to the project) |
| `SESSION_SECRET` | yes | HMAC key for session cookies. Rotating it signs everyone out. |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` / `PATCH` | `/api/me` | Read or update your profile |
| `GET` | `/api/users?q=` | Find people by username |
| `GET` / `POST` | `/api/chats` | List conversations / start a chat or group |
| `GET` / `PATCH` / `DELETE` | `/api/chats/[id]` | Details / rename, photo, members / leave |
| `GET` / `POST` | `/api/chats/[id]/messages` | History (`?since=`, `?cursor=`, `?limit=`) / send |
| `POST` | `/api/chats/[id]/read` | Mark read |
| `PATCH` / `DELETE` | `/api/messages/[id]` | Edit / delete your own message |
| `POST` | `/api/upload` | Upload a photo |

## Known limits

- **Polling, not push.** New messages appear within about 2-4 seconds rather than instantly.
- **No delivery guarantee for the online state.** "Delivered" is inferred from the recipient's
  last-seen time, so it can over-report if they were online without receiving the message.
- **Chat history is capped per fetch** (45 messages per page, with "load older" paging) and
  large conversations cost one `list()` page per chunk of history.
- **Photos are public** (unguessable URL, but not access-controlled). Serving them through an
  authenticated proxy is the next step.
- There is no push notification, voice/video calling, message search across conversations, or
  end-to-end encryption.
