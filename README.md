# Varnox

A messenger web app: one-to-one chats and group conversations, voice notes, photos and
documents, reactions, replies, forwarding, starred messages, disappearing timers, read
receipts and privacy controls — in a two-pane layout that works on desktop and phone.
Installable as a PWA.

Varnox is its own product with its own name, mark and palette. It deliberately follows the
familiar conventions of a mainstream messenger, but it does not copy anyone's logo, artwork or
trade dress.

Live: https://varnox-chat.vercel.app

## Features

- **Accounts** — sign in with a **phone number and a 6-digit code sent by SMS**. You enter your
  number, Varnox texts a code, and entering it signs you in; a number nobody has used before
  becomes an account at that moment, so there is no separate registration step and the next thing
  you see is a prompt for your name. Numbers are normalised to `+<countrycode><number>` and must be
  unique; the phone is the login ID and the way other people find you.
- **Code sign-in is built for abuse, not just convenience** — codes are stored only as an HMAC
  (never in the clear), expire after 10 minutes, are single-use, and are thrown away after five
  wrong guesses. Sending is capped per number (3 per 15 minutes) and per IP (10 per hour) with a
  60-second resend cooldown, because every message costs money at the provider. The start endpoint
  answers the same way whether or not the number has an account, so it cannot be used to discover
  who is registered.
- **Password sign-in still works** — accounts created before phone login keep their password, one
  tap away behind *Use a password instead*. Passwords are hashed with scrypt (per-user salt); the
  session is an HMAC-signed, HttpOnly, SameSite=Lax cookie.
- **Discovery** — search by phone number (spaces, dashes and brackets are all accepted).
- **1:1 chats** — find someone by number, start a chat, message back and forth.
- **Groups** — create a group with **nobody else in it** if you like, then fill it later by
  adding people by number or by sharing an invite link. Group photo, admin roles, add and remove
  members, leave.
- **Messaging** — text, emoji picker, photo attachments (compressed in the browser before
  upload), reply-to, edit and delete your own messages, day separators, message grouping.
- **Voice notes** — record in the browser and send; the player has a seekable waveform and
  a clock.
- **Documents** — send any file type with its name and size, downloadable from the bubble.
- **Reactions** — long-press/hover a bubble and pick an emoji; chips show who reacted and
  tapping yours removes it.
- **Forwarding** — pass a message on to one or several chats; forwarded copies are labelled.
- **Multi-select** — select several messages to star, forward, copy or delete together.
- **Starred messages** — keep a message and find it again from Settings.
- **Search** — search box in the sidebar filters chats; the menu searches message text across
  every conversation, and each chat has its own in-chat search.
- **Chat management** — pin, mute and archive chats, with All / Unread / Groups filters.
- **Disappearing messages** — per-chat timer of 24 hours, 7 days or 90 days.
- **Presence** — typing indicator in the chat header, and an online / last-seen line.
- **Status** — unread badges, last-message previews with a type glyph, tick states: one tick
  sent, two ticks delivered, blue ticks read.
- **Message info** — per-message delivered/read breakdown for every member.
- **Notifications** — browser notification and a chime when a message lands in a background tab.
- **Privacy** — last seen, profile photo and read receipts can each be limited or switched off,
  enforced on the server; block a contact to close the chat in both directions.
- **Interface** — light and dark themes, five chat wallpapers, responsive, installable PWA.

## Architecture

Next.js (App Router) hosted on Vercel, with **Postgres (Neon) as the datastore**.

### Why Postgres and not Vercel Blob

This app originally used Vercel Blob as its datastore, with no separate database. That store
was suspended (`limits-exceeded-suspended`) while holding only **2.5 KB across 18 blobs**,
because Blob's binding constraint on the Hobby plan is **operations**, not size — and `put()`
and `list()` both count as the expensive "Advanced Operations" kind. The original design hit
those constantly:

- Every mutation wrote a **new** blob and never overwrote one, so the store grew without bound.
  A presence heartbeat alone wrote a blob every 45 seconds, forever.
- Nearly every read called `list()` to find the newest version.
- The client polls hard (`loadChats` every 3.5s, the open chat every 2s), so one open tab
  generated thousands of advanced operations per hour.

Postgres has none of those problems: a row is updated in place, reads are indexed, and there is
no per-operation quota. The old "newest version wins" rule — which existed only to dodge CDN
cache staleness on overwrite — collapses into a plain `UPDATE`, and the unbounded growth goes
away with it.

The schema is in [`db/schema.sql`](db/schema.sql); apply it with `npm run db:apply`. Tables are
prefixed `vx_`. The exported API of `lib/db.ts` is unchanged, so the routes and the UI were not
touched by the move.

Media (images, voice notes, files) lives in the `vx_media` table and is served back through
`GET /api/media/<id>`. It used to go to Blob, which is why it moved too.

### Other notes

- **Realtime is polling.** Vercel serverless functions cannot hold WebSocket connections. The
  open conversation is polled every 2s using `?since=<timestamp>` so only new messages cross
  the wire; the chat list refreshes every 3.5s. Polling pauses when the tab is hidden. This is
  now merely wasteful rather than quota-destroying, but it is still the main load on the
  database if the app ever gets busy.
- **Reads are cheap.** Queries are indexed and a short-lived in-process cache (`lib/cache.ts`)
  absorbs the repeat reads from polling on warm function instances.
- **Media** is uploaded via `POST /api/upload` after client-side downscaling (max 1600px, JPEG
  q0.82, 6 MB limit, and the route caps bodies at 4 MB), stored in Postgres, and served from
  `GET /api/media/<id>`.
- **Ticks** derive from per-conversation read receipts: two ticks means every other member has
  been online since the message was sent, blue ticks means they have read past it.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL and SESSION_SECRET
npm run db:apply             # create the tables, including the code tables (safe to re-run)
npm run dev                  # http://localhost:3000

# To sign in locally without an SMS account, put SMS_DEV_MODE=1 in .env.local:
# the code is printed to the terminal running `npm run dev`.
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (Neon). Use the pooled endpoint. |
| `SESSION_SECRET` | yes | HMAC key for session cookies. Rotating it signs everyone out. |
| `SMS_PROVIDER` | one of these two | `twilio`, `vonage`, `messagebird`, `generic` or `console` |
| `SMS_DEV_MODE` | one of these two | `1` prints login codes to the server log instead of sending them, for local work |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` *or* `TWILIO_MESSAGING_SERVICE_SID` | for Twilio | Credentials for the Twilio Messages API |
| `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_FROM` | for Vonage | Vonage SMS credentials |
| `MESSAGEBIRD_API_KEY`, `MESSAGEBIRD_ORIGINATOR` | for MessageBird | MessageBird credentials |
| `GENERIC_SMS_URL`, `GENERIC_SMS_TOKEN`, `GENERIC_SMS_BODY` | for generic | Any JSON SMS gateway; `{to}` and `{text}` are substituted into the body |
| `SMS_CODE_PEPPER` | no | Extra secret for hashing codes at rest; falls back to `SESSION_SECRET` |

With neither `SMS_PROVIDER` nor `SMS_DEV_MODE` set, the server says so instead of pretending a
code was sent, so a half-configured deployment fails loudly rather than locking everyone out.

`pg` does not understand Neon's `channel_binding=require` parameter, so `lib/pg.ts` strips it
when opening the pool — you can paste Neon's string in verbatim.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `POST` | `/api/auth/otp/start` | Send a login code to a phone number (throttled per number and per IP) |
| `POST` | `/api/auth/otp/verify` | Check the code, sign in, and create the account if the number is new |
| `GET` / `PATCH` | `/api/me` | Read or update your profile |
| `GET` | `/api/users?q=` | Find people by username (blocked accounts are hidden) |
| `GET` / `PATCH` | `/api/settings` | Wallpaper, notifications, privacy, chat prefs, blocked list |
| `POST` | `/api/presence` | Presence heartbeat, returns peer presence |
| `GET` | `/api/search?q=` | Search message text across your chats |
| `GET` / `POST` | `/api/chats` | List conversations / start a chat or group |
| `GET` / `PATCH` / `DELETE` | `/api/chats/[id]` | Details / rename, photo, members, disappearing timer / leave |
| `GET` / `POST` | `/api/chats/[id]/messages` | History (`?since=`, `?cursor=`, `?limit=`) with reactions + typing / send |
| `POST` | `/api/chats/[id]/read` | Mark read (respects the read-receipts setting) |
| `POST` | `/api/chats/[id]/typing` | Typing ping |
| `POST` | `/api/chats/[id]/invite` | Create a group invite link |
| `POST` | `/api/join` | Join a group with an invite code |
| `PATCH` / `DELETE` | `/api/messages/[id]` | Edit / delete your own message |
| `POST` | `/api/messages/[id]/react` | Add or clear an emoji reaction |
| `POST` / `DELETE` | `/api/messages/[id]/star` | Star / unstar a message |
| `GET` | `/api/starred` | Starred messages |
| `POST` | `/api/messages/bulk` | Star, unstar or delete several messages at once |
| `POST` | `/api/messages/forward` | Forward messages into other chats |
  | `POST` | `/api/upload` | Upload a photo, voice note or document |
  | `GET` | `/api/media/[id]` | Serve an uploaded image, voice note or document |

## Known limits

- **Every code costs money.** A send is a real charge at the provider (Twilio Verify, for
  comparison, is $0.05 per successful verification plus SMS fees as of August 2026), which is why
  sending is capped per number and per IP. Watch for **SMS pumping**: a spike of sends to numbers
  you never expect, or to one country you do not serve, means someone found the endpoint. Lower
  `SEND_PER_IP` in `lib/otp.ts` and restrict the countries you send to.
- **Changing the number in Profile does not re-verify it.** The code proves control of the number
  used to sign in. A number added later through Profile is unique, but nothing has proven it.
- **A verified number is not a permanent identity.** Controlling a SIM today does not stop someone
  porting or losing it tomorrow, so add recovery codes and, if it matters, a PIN or passkey.
- **Polling, not push.** New messages appear within about 2-4 seconds rather than instantly.
- **No delivery guarantee for the online state.** "Delivered" is inferred from the recipient's
  last-seen time, so it can over-report if they were online without receiving the message.
  - **Chat history is capped per fetch** (45 messages per page, with "load older" paging). Each
    page is one indexed query, so paging deeper does not get progressively more expensive.
- **Uploads are capped at 4 MB** because Vercel functions reject larger request bodies.
- **Attachments are public** (unguessable URL, but not access-controlled). Serving them through
  an authenticated proxy is the next step.
- **Not implemented yet:** voice and video calls, status/stories, end-to-end encryption,
  multi-device linking, and contact/address-book sync.
- **Search is bounded** — it scans the most recent messages of your 12 most recent chats rather
  than every message ever sent.
