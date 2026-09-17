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
- **Creating an account collects phone number, then email, then password** — one step at a time.
  The address is stored lowercased and is unique case-insensitively (a partial unique index on
  `lower(email)`), it signs you in alongside the number and your username, and it is the intended
  way back into the account if the number is lost. It is **not** visible to anyone else: every
  projection of another member returns `null` for it, and the address is unverified until an email
  confirmation channel ships.
- **View-once photos and voice notes** — flick the "1" toggle in the composer and the next photo
  or recording can be opened by the recipient exactly once. The flag is enforced by the data, not
  by the UI: media marked once is served only with a token minted by `POST /api/messages/<id>/open`,
  which records the view first, so the URL in a chat payload is not a permanent link. The view is
  claimed with a conditional insert, so two taps arriving together cannot both be first. What it
  cannot do: stop a screenshot, or a screen photo. It prevents replay, not recording.
- **Code sign-in is built for abuse, not just convenience** — codes are stored only as an HMAC
  (never in the clear), expire after 10 minutes, are single-use, and are thrown away after five
  wrong guesses. Sending is capped per number (3 per 15 minutes) and per IP (10 per hour) with a
  60-second resend cooldown, because every message costs money at the provider. The start endpoint
  answers the same way whether or not the number has an account, so it cannot be used to discover
  who is registered.
- **Password sign-in still works** — accounts created before phone login keep their password, one
  tap away behind *Use a password instead*, and the identifier field accepts the phone number, the
  email address or the username. Passwords are hashed with scrypt (per-user salt); the session is an
  HMAC-signed, HttpOnly, SameSite=Lax cookie.
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

## Deploys and migrations

A Vercel deploy and a database migration are two separate acts, and nothing stops them
getting out of step. When that happened here, the symptoms looked like several unrelated
bugs at once: the display picture stopped saving, sign-up failed, email sign-in errored, and
— least obviously — signing in with a *correct* password failed while a wrong password still
returned a healthy-looking 401.

Two things guard against it now:

- **The app reconciles the idempotent part of the schema itself**, once per process, on the
  first request it serves (`lib/migrate.ts`). Adding a column or a table needs no manual
  step; every statement is `if not exists`, so a current database is left alone. Data
  migrations and anything destructive stay in `db/schema.sql`, run deliberately.
  Set `AUTO_MIGRATE=0` to switch this off and manage the schema by hand.
- **`GET /api/health`** reports the truth: 200 with `autoApplied` naming what it fixed, or
  503 naming what is still missing. A driver error for an unknown column or table is
   translated into "This server needs a database migration" instead of a bare 500.

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
| `AUTO_MIGRATE` | no | `0` disables the app reconciling the schema on first request; see *Deploys and migrations* |
| `ADMIN_USERNAMES` | no | Comma-separated handles allowed to reach `/api/admin/*`; see *Suspending and deleting accounts*. **Fails closed** — unset means nobody is an admin and every admin route answers 403 |

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
| `GET` | `/api/health` | Whether the database matches the code; names anything missing (503 when it does not) |
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
| `POST` | `/api/account/delete` | Delete **your own** account (soft; confirmed by typing your handle) |
| `POST` | `/api/account/review` | Ask for a suspension to be looked at — the one route a suspended account may call |
| `GET` | `/api/admin/accounts` | *(owner)* List accounts; `?only=suspended` narrows, review requests first |
| `POST` | `/api/admin/accounts/[id]/suspend` | *(owner)* Suspend an account, with an optional `reason` |
| `POST` | `/api/admin/accounts/[id]/reinstate` | *(owner)* Lift a suspension |
| `POST` | `/api/admin/accounts/[id]/delete` | *(owner)* Delete somebody else's account (soft; confirmed by typing their handle) |
| `POST` | `/api/reports` | Report a user, a group or one message |
| `GET` | `/api/admin/reports` | *(owner)* The report queue; `?only=all` includes closed ones |
| `POST` | `/api/admin/reports/[id]/close` | *(owner)* Mark a report as dealt with |
| `GET` | `/api/admin/blocked` | *(owner)* Numbers barred from signing up or in |
| `POST` | `/api/admin/blocked` | *(owner)* Block a number |
| `POST` | `/api/admin/blocked/remove` | *(owner)* Lift a block |
| `GET` | `/api/admin/audit` | *(owner)* Who did what, newest first |

## Suspending and deleting accounts

Two different things, and neither removes data:

**Suspend** sets `suspended_at` on the account. It cannot sign in — `requireUser()` refuses it, and
that is the single gate every authenticated route passes through — and it sees a banner saying the
account cannot use Varnox, with a button to request a review. Nothing of theirs is touched: the
chats, the messages and the profile all stay. Lifting it is a single column going back to null, so
the account is exactly as it was.

The account can still *sign in* while suspended, deliberately. Signing it out instead would leave
it staring at the sign-in form with no explanation — which looks like a broken app — and would
throw away the session needed to prove who is asking for a review.

**Delete** is soft and permanent: it sets `deleted_at` and releases the phone number, so the
account stops signing in and stops appearing in search, the directory, group rosters and the
results of anyone trying to message it. Messages stay in the threads they were sent to, because
they are not only that account's to remove. The handle is deliberately *not* released — a freed
handle is an invitation to impersonate somebody who has just left.

Owner powers need `ADMIN_USERNAMES` set to your handle, otherwise every `/api/admin/*` route
answers 403. There is no admin screen in the app; these routes are called directly, and the
requester's identity is always re-read from the session rather than taken from the request.

### Something to act on

**Reports** are how a decision gets asked for by somebody who is not the accused. Anyone can
report a user, a group or a single message from the report action in a chat's info panel. The
name shown in the queue is resolved from the database, never taken from the request — the queue
is text an owner acts on, so anything a reporter could type into it would be a way to put a
different person's name in front of the owner. Reporting the same target twice does not file two
reports, one account's open reports are capped so the queue cannot be flooded, and a closed
report can be filed again because a second offence is a new event.

Closing a report records **what was decided, not what was done** — the suspension is a separate
action with its own audit entry. A closed report with no suspension beside it therefore means the
report was read and nothing was warranted, which is a real outcome worth being able to see.

### Repeat offenders

Suspension is per-account, so it costs one new SIM to walk around. `vx_blocked_phones` is the part
that does not: a blocked number gets no login code, cannot register, and cannot sign in with a
password. Numbers are stored as `phoneKey()` writes them, so a block catches the same number typed
with or without a plus.

The replies differ by endpoint on purpose. `/api/auth/otp/start` takes any number from anyone, so
it answers exactly as it would for a real send and merely sends nothing — a distinct answer would
turn it into a way to ask whether a number is blocked. `/api/auth/login` answers like a wrong
password, the same treatment a deleted account gets. `/api/auth/register` refuses plainly, because
somebody creating an account is asserting an identity and a vague error would only send them round
the same form again.

Two details make the quiet answer actually quiet, and both are easy to get wrong:

- **The block is decided inside `startOtp`, after the rate slots are spent — not in the route.**
  Returning early from the route skips the throttles, and the two answers then differ in the one
  way that is trivial to observe: a real number answers 429 on a second request inside the
  cooldown, while a blocked number would answer 200 every time. That difference is itself a way
  to ask whether a number is blocked.
- **`verifyOtp` checks the list too.** A code is good for ten minutes, so blocking a number a
  moment after a code was sent would otherwise leave that code exchangeable for a session — and,
  for a number with no account yet, for a brand new one. It answers exactly as an absent code
  does, so nothing is revealed either way.

**A block does not end existing sessions.** It stops a number obtaining a *new* one. Ending the
sessions an account already holds is what suspension is for, and the two are meant to be used
together: suspend the account to stop it being used, block the number to stop it coming back.

### Knowing who did what

Every owner action writes a row to `vx_admin_audit` — suspend, reinstate, delete, block, unblock,
close-report — naming the actor, the target and the reason. It is written **after** the action
succeeds, never before: a record claiming something happened that did not is worse than no record,
because it is the thing anybody would consult to find out what really happened. There is no route
to edit or delete an entry.

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

---

## Bots

Accounts manage the bots they own from `/bots`, reached from the sidebar menu, the phone tab bar,
and a row in Settings.

### Architecture, and the one thing it cannot do

`varnox-chat` is the frontend and the application backend. A **separate, self-hosted Telegram Bot
API server** (`telegram-bot-api`) is what Varnox talks to over HTTP, through the server-side
`TELEGRAM_BOT_API_URL`. None of that C++ server is vendored into this app.

**Varnox cannot create a Telegram bot or reserve a Telegram username.** There is no such method in
the Bot API — bot tokens are issued only by @BotFather inside Telegram. So the wizard's username
step is a **Varnox handle** (unique across the app), and the Telegram token is a separate, optional
field that has to be pasted in from @BotFather. The two are distinct everywhere: `handle` versus
`telegramUsername`.

### The create wizard

Three steps, then the token:

1. **Bot name** — free text.
2. **Username** — a Varnox handle, pre-suggested from the name and editable. Lowercase letters,
   digits, `-` and `_`, 5–32 characters, starting and ending alphanumeric, and **ending in `-bot` or
   `_bot`** — the separator is required, so `support-bot` is accepted and `supportbot` is not.
   Uniqueness is global, on `lower(handle)`. A capitalised entry is folded, not rejected.
3. **Telegram token, description, active** — all optional. The token is sealed before storage.

On success the plaintext Varnox API token is shown **once**, with a copy button. Only its SHA-256
hash is stored, so it cannot be shown again — losing it means deleting the bot and recreating it.

### The two secrets

| | Stored as | Why |
|---|---|---|
| Varnox API token | SHA-256 hash only | Nothing ever needs to read it back. A plain hash rather than scrypt, because 256 random bits have no guessing space for a work factor to slow down, while verification happens on every call. |
| Telegram bot token | AES-256-GCM sealed | Telegram has to be shown the original, so it cannot be hashed. The key is HKDF-derived from `TELEGRAM_TOKEN_KEY`, falling back to `SESSION_SECRET`. |

No list or detail projection selects either secret. The bot projections take
`(telegram_secret is not null) as has_telegram` — a boolean that answers "is one on file" without
the column ever crossing the wire from Postgres.

Rotating the key makes stored Telegram tokens unreadable. That is not silent: the test action
answers 409 and says to save the token again.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_API_URL` | for the Telegram test | The bot API server's address. With it unset the screen shows a setup banner and the test answers 503 — there is no hardcoded fallback, because a default would point a fork at a server it did not choose. |
| `TELEGRAM_TOKEN_KEY` | recommended | Key for sealing Telegram tokens. Falls back to `SESSION_SECRET`. |

### Routes

| Route | Purpose |
|---|---|
| `GET /api/bots` | This account's bots, newest first. |
| `POST /api/bots` | Create a bot; returns the plaintext token exactly once. |
| `GET /api/bots/[id]` | One bot. |
| `DELETE /api/bots/[id]` | Delete a bot and its tokens. |
| `POST /api/bots/[id]/revoke-token` | Withdraw the live token. |
| `POST /api/bots/[id]/telegram/test` | `getMe` against the bot API server. |

These are distinct from `/api/bot` (singular) next door, which is the message bridge to the
operator's WhatsApp bot. The two share a namespace and nothing else.

Every route goes through `requireUser()`, every query is scoped by `user_id`, and another account's
bot id reads as **404, not 403** — a distinct "exists but not yours" would let ids be enumerated.
Handles are the single exception to owner-scoping: `handleTaken()` is global by definition, and
returns only a boolean.

### Migrations

`vx_bots` and `vx_bot_tokens` are additive, so `npm run db:apply` is safe to re-run on a live
database and `ensureSchema()` reconciles them on the first request. The `handle` column is added
with `alter table … add column if not exists` **before** its index, because `create table if not
exists` is a no-op on a database that already has the table — without that ordering, a fresh
database would work and an existing one would fail with `column "handle" does not exist`. The index
is partial (`where handle is not null`) so rows written before the column existed do not collide.

### Tests

`npm test` runs Vitest. `tests/bots-token.test.ts`, `tests/bot-handle.test.ts`,
`tests/validate.test.ts`, `tests/secretbox.test.ts` and `tests/telegram.test.ts` are pure and always
run. `tests/bots-db.test.ts` needs `DATABASE_URL` and skips without it; it reconciles the schema
itself, so an empty database is enough. It covers authorization isolation between two real
accounts, revocation, handles, sealed-at-rest storage, and the token never leaking into any
`getMe` failure path.

### Linting

`npm run lint` runs **oxlint**, not ESLint. ESLint's Next.js config bundles `typescript-eslint`,
which refuses to load against this project's TypeScript 7 compiler, and the npm override needed for
the documented side-by-side TypeScript 6 arrangement does not take effect because TypeScript is
hoisted. oxlint parses TypeScript natively and needs no TypeScript API. `.oxlintrc.json` turns off
rules whose premise does not hold here (`react-in-jsx-scope` under the automatic runtime, the
`react-perf` category) and records the pre-existing findings in untouched components as warnings, so
the script exits 0 and stays useful as a signal for new code.

### BotFather, in the app

`/bots/father` is a conversation, not a form. Telegram's BotFather is a bot you talk to, and this is
the same idea pointed at Varnox's own bots:

| Command | What it does |
|---|---|
| `/newbot` | Walks through bot name, then username, then an optional Telegram token, then hands over the Varnox API token. |
| `/mybots` | Lists the account's bots as buttons. Choosing one shows its state with Test Telegram, Revoke and Delete. |
| `/deletebot` | Same list, then a confirmation before anything is removed. |
| `/cancel` | Abandons whatever step the conversation is on. |
| `/help` | The command list again. |

Reached from the sidebar menu, the settings row, and a button on the Bots screen. The same commands
are also available as chips above the composer, so they can be found without knowing them.

**It is a conversation and nothing else.** Every action goes through the same `/api/bots` routes the
Bots screen uses, which do the auth, validation, rate limiting and minting. There is no second
implementation of any of that — the command you type becomes a request, and the reply is whatever
the server said. Conversation state lives in React state: no localStorage, no mock data.

**Why this replaced the idea of a Telegram-side BotFather.** The signed-in session is the account
link. A bot in Telegram would let anyone press START and would need its own account-linking step to
avoid being a public credential factory. Here, only somebody already signed in to the account can
load the page, so the minting path is unreachable to anyone who does not own the account it mints
for.

One deliberate difference from Telegram's BotFather: it requires a bot's username to end in `bot`.
Varnox handles do not — the rule is already part of the API contract and is covered by tests, so the
conversation suggests a handle derived from the name rather than enforcing a suffix.

### The token API: `/api/v1`

This is the surface a **bot token** is accepted on. Everything else in the app authenticates with a
session cookie; these endpoints take `Authorization: Bearer vx_…` instead, so an integration holds a
credential that names a program, can be scoped, and can be withdrawn without ending anybody's
session.

| Endpoint | Does |
|---|---|
| `GET /api/v1/me` | Who the token is: the bot, and the account it acts for. Call this first. |
| `GET /api/v1/numbers` | The paired numbers this token can send from. |
| `POST /api/v1/messages` | `{"session": "web_+1555…", "body": "…"}` — queue a message as the owner. |

```bash
TOKEN=vx_…

curl -s https://varnox-chat.vercel.app/api/v1/me \
  -H "Authorization: Bearer $TOKEN"
# {"owner":{"username":"…","displayName":"…"},
#  "bot":{"id":"bot_…","handle":"support-bot","name":"Support bot","active":true,…}}

curl -s https://varnox-chat.vercel.app/api/v1/numbers \
  -H "Authorization: Bearer $TOKEN"
# {"numbers":[{"id":"web_+1555…","phone":"+1555…","status":"connected","updatedAt":…}]}

curl -s -X POST https://varnox-chat.vercel.app/api/v1/messages \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"session":"web_+1555…","body":"hello"}'
# 201 {"message":{"id":42,"at":…},"note":"Queued for the paired number. …"}
```

**A token is the account.** These routes act as the token's owner, so anything they expose is
exposed to whoever holds the token. That is what "a bot acting for its owner" has to mean — but it
is also why the surface is built one endpoint at a time rather than by mirroring the whole app.
`GET /api/v1/numbers` returns phone numbers in full, and a session id is `web_` plus the same
number, so masking them would obscure without hiding.

**Every refusal is the same 401**, with the same sentence, whatever went wrong — no header, a
malformed token, a token that never existed, a revoked token, a bot the owner switched off. A
caller that could tell those apart could probe for facts it was not given, and the legitimate
holder has no use for the difference: the answer in every case is "check your credential", and the
Bots screen states plainly whether a token is live. The refusal never echoes the presented value,
so a typo cannot write a credential into the caller's logs.

Metered at **120 calls per minute per bot** — per bot rather than per account, so one runaway
integration does not spend the allowance of the account's other bots. Exceeding it answers **429**,
not 401: the credential is fine and the caller should retry.

A token is proved by hashing the presented value and comparing in constant time, so the stored hash
is useless as a credential — presenting it is refused like anything else. Revoking takes effect on
the next request, since verification only accepts a token row whose `revoked_at` is null.

### Running a bot: START, the inbox, and replies

A bot's process **polls Varnox**. Nothing is pushed to it, and it needs no inbound port — which is
what makes this work on a Pterodactyl container, behind NAT, or anywhere else that cannot accept a
connection from outside.

| Step | Endpoint | Auth |
|---|---|---|
| The user presses **Start** | `POST /api/bots/[id]/start` | session cookie |
| The user says something | `POST /api/bots/[id]/messages` | session cookie |
| The user reads the thread | `GET /api/bots/[id]/messages` | session cookie |
| The bot takes work | `GET /api/v1/inbox?wait=25` | **bot token** |
| The bot answers | `POST /api/v1/inbox/[id]/reply` | **bot token** |
| The bot reads context | `GET /api/v1/thread` | **bot token** |

**Start** opens the conversation and queues `/start` — the same convention Telegram uses, so a bot
written for Telegram ports without changes. It is idempotent: pressing it again opens the thread and
does not greet the bot a second time.

A worker that does all of it:

```js
// worker.js — put VARNOX_BOT_TOKEN in the panel's startup variables
const TOKEN = process.env.VARNOX_BOT_TOKEN;
const API = (process.env.VARNOX_URL || 'https://varnox-chat.vercel.app') + '/api/v1';
const auth = { Authorization: `Bearer ${TOKEN}` };

async function call(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('rate limited — back off: ' + body.error);
  if (!res.ok && res.status !== 409) throw new Error(`${res.status} ${body.error || ''}`);
  return body;
}

for (;;) {
  try {
    // Long poll: returns as soon as a message arrives, or after 25s.
    const { messages } = await call(`${API}/inbox?wait=25`, { headers: auth });
    for (const m of messages) {
      const body = m.body.trim() === '/start' ? 'Hello! Send me anything.' : `You said: ${m.body}`;
      await call(`${API}/inbox/${m.id}/reply`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
    }
  } catch (err) {
    console.error('[varnox]', err.message);
    await new Promise((r) => setTimeout(r, 5000));   // and let a 401 be fatal if you prefer
  }
}
```

#### Claiming, which is the part that matters

`GET /api/v1/inbox` does not merely read — it **claims**. The messages it returns are moved out of
`pending` in the same statement that selects them, so the same message is never handed to two
pollers. Without that, a container that restarted, or two replicas behind a load balancer, would
each answer every message and the user would get each reply twice.

The claim **expires after five minutes**. A bot that died between claiming and replying would
otherwise hold the message forever; instead it becomes claimable again and the crash costs a delay
rather than the message.

**Claim before you reply.** `POST /api/v1/inbox/[id]/reply` only accepts a message this bot has
claimed; anything else is a 409. That is what keeps the claim meaningful — a bot cannot answer a
message it never took, which is the case that would let two pollers both reply.

The long poll is an optimisation, not a mechanism: if the platform kills a request at its function
limit, the client simply polls again and is slower, not wrong. `wait` is capped at 25 seconds.

#### What a token cannot do

- **Only its own owner's data.** Every query behind the API is scoped by the token's owner, and the
  inbox is scoped by bot id as well, so one bot cannot take another bot's queue even on the same
  account.
- **Only conversations that were started.** A bot with no thread has no inbox, because START is the
  point at which a conversation begins.
- **No public discovery.** All three screens operate on bots you own. There is no directory of other
  people's bots, no groups, and no way to message somebody else's bot — those are separate features
  with their own moderation questions, and none of them is built.

### Known gaps

- **No re-issue route.** Revoking is terminal for a bot: one bot, one token, issued at creation.
  Two ways to obtain a credential would mean two places to get "show it once" wrong.
- **`botForToken()` has no route yet.** It is the verification entry point a bot-authenticated API
  would use — built and tested, including that it fails closed for a revoked token and an inactive
  bot — but nothing currently consumes a Varnox bot token over HTTP.
- **Never verified against a live Telegram server.** `getMe` is exercised against stubbed
  responses, so the request shape is covered but not a real round trip.
