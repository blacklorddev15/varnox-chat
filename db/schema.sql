-- Varnox schema.
--
-- This replaces the previous Vercel Blob datastore. The Blob design was append-only:
-- every mutation wrote a NEW uniquely-named blob and readers took the newest version
-- under a prefix, because an overwritten blob kept serving stale bytes from the CDN.
-- Postgres has no such problem, so every "newest version wins" file becomes a single
-- row that is simply updated. That also removes the unbounded growth the old scheme
-- had (presence heartbeats alone wrote a new blob every 45 seconds, forever).
--
-- Timestamps are epoch milliseconds in bigint, matching the app's `Date.now()` values.
-- Table names are prefixed `vx_` to match the app's existing namespace.
--
-- Safe to re-run: everything is IF NOT EXISTS.

/* ── accounts ─────────────────────────────────────────────────────────── */

create table if not exists vx_users (
  id            text primary key,
  username      text not null,
  phone         text,
  display_name  text not null,
  about         text not null default '',
  avatar        text,
  pw_hash       text not null,
  created_at    bigint not null,
  last_seen     bigint not null
);

-- Handles are unique case-insensitively, which is how the app looks them up.
create unique index if not exists vx_users_username_lower on vx_users (lower(username));
create index if not exists vx_users_phone on vx_users (phone);

-- Handle and number reservations. Login resolves through these, so they are the
-- authority on "taken", not vx_users.
create table if not exists vx_usernames (
  username   text primary key,   -- lowercased
  user_id    text not null,
  created_at bigint not null default 0
);
create index if not exists vx_usernames_user on vx_usernames (user_id);

create table if not exists vx_phones (
  phone   text primary key,      -- digits only, via phoneKey()
  user_id text not null
);
create index if not exists vx_phones_user on vx_phones (user_id);

/* ── conversations ────────────────────────────────────────────────────── */

create table if not exists vx_convs (
  id            text primary key,
  type          text not null,
  name          text not null default '',
  avatar        text,
  members       jsonb not null default '[]'::jsonb,
  admins        jsonb not null default '[]'::jsonb,
  created_by    text not null,
  created_at    bigint not null,
  disappear_sec integer not null default 0
);
create index if not exists vx_convs_members on vx_convs using gin (members);

-- Per-user sidebar entry for a conversation. `is_left` hides the chat for one member.
-- (Named is_left rather than left because LEFT is a reserved word in SQL, and a column
-- that has to be quoted everywhere is a bug waiting to happen.)
create table if not exists vx_markers (
  user_id     text not null,
  conv_id     text not null,
  conv_name   text not null default '',
  conv_type   text not null,
  conv_avatar text,
  at          bigint not null,
  last        jsonb,
  is_left     boolean not null default false,
  primary key (user_id, conv_id)
);
create index if not exists vx_markers_user_at on vx_markers (user_id, at desc);

/* ── messages ─────────────────────────────────────────────────────────── */

create table if not exists vx_messages (
  id          text primary key,
  conv_id     text not null,
  sender_id   text not null,
  sender_name text not null,
  at          bigint not null,
  type        text not null,
  text        text not null default '',
  media_url   text,
  media_w     integer,
  media_h     integer,
  audio_sec   integer,
  file_name   text,
  file_size   bigint,
  mime        text,
  forwarded   boolean not null default false,
  reply_to    jsonb
);

-- The hot read paths: the newest page of a conversation, and unread counting.
create index if not exists vx_messages_conv_at on vx_messages (conv_id, at desc, id desc);
create index if not exists vx_messages_conv_sender_at on vx_messages (conv_id, sender_id, at);

-- Deferred edits and deletes. One row per message: the newest op wins.
create table if not exists vx_msg_ops (
  msg_id  text primary key,
  conv_id text not null,
  op      text not null,
  text    text,
  at      bigint not null
);
create index if not exists vx_msg_ops_conv on vx_msg_ops (conv_id);

create table if not exists vx_reactions (
  msg_id  text not null,
  user_id text not null,
  conv_id text not null,
  emoji   text not null,
  at      bigint not null,
  primary key (msg_id, user_id)
);
create index if not exists vx_reactions_conv on vx_reactions (conv_id);

/* ── read state ───────────────────────────────────────────────────────── */

-- A user's own high-water mark per conversation. Always drives their unread badge.
create table if not exists vx_reads (
  user_id text not null,
  conv_id text not null,
  at      bigint not null,
  primary key (user_id, conv_id)
);

-- Read receipts shared with the other members. Only written when the user has read
-- receipts turned on, which is why this is separate from vx_reads.
create table if not exists vx_conv_reads (
  conv_id text not null,
  user_id text not null,
  at      bigint not null,
  primary key (conv_id, user_id)
);

/* ── per-user odds and ends ───────────────────────────────────────────── */

create table if not exists vx_starred (
  user_id   text not null,
  msg_id    text not null,
  conv_id   text not null default '',
  conv_name text not null default '',
  at        bigint not null,
  removed   boolean not null default false,
  snapshot  jsonb not null default '{}'::jsonb,
  primary key (user_id, msg_id)
);
create index if not exists vx_starred_user_at on vx_starred (user_id, at desc);

create table if not exists vx_settings (
  user_id       text primary key,
  wallpaper     text not null default 'doodle',
  notifications boolean not null default true,
  privacy       jsonb not null default '{}'::jsonb,
  chat_prefs    jsonb not null default '{}'::jsonb,
  blocked       jsonb not null default '[]'::jsonb,
  at            bigint not null
);

create table if not exists vx_typing (
  conv_id text not null,
  user_id text not null,
  at      bigint not null,
  primary key (conv_id, user_id)
);

create table if not exists vx_presence (
  user_id text primary key,
  at      bigint not null
);

create table if not exists vx_invites (
  code       text primary key,
  conv_id    text not null,
  created_by text not null,
  created_at bigint not null
);

/* ── media ────────────────────────────────────────────────────────────── */

-- Replaces the Blob store for images, voice notes and files. The client already
-- downscales images before upload and the route caps bodies at 4 MB.
create table if not exists vx_media (
  id         text primary key,
  mime       text not null,
  bytes      bytea not null,
  size       integer not null,
  created_at bigint not null
);

/* ── phone verification (SMS one-time codes) ──────────────────────────── */

-- The one code in flight for a number. A new send replaces the row rather than adding
-- one, so there is never more than a single valid code and nothing to garbage-collect
-- beyond the opportunistic sweep in putOtp().
--
-- `code_hash` is an HMAC of the code keyed by the server secret with the number mixed
-- in, never the code itself: a database leak then yields no usable codes, and a code
-- observed for one number cannot be replayed against another.
create table if not exists vx_otp (
  phone       text primary key,      -- digits only, via phoneKey()
  code_hash   text not null,
  sent_at     bigint not null,
  expires_at  bigint not null,
  attempts    integer not null default 0,
  consumed_at bigint,
  sent_ip     text
);
create index if not exists vx_otp_expires on vx_otp (expires_at);

-- Fixed-window throttling buckets, so the login form cannot be turned into an SMS
-- cannon. `bucket` is a scope string, e.g. "send:phone:6591234567", "send:ip:1.2.3.4"
-- or "cooldown:phone:6591234567" for the resend timer.
create table if not exists vx_otp_rate (
  bucket        text primary key,
  count         integer not null default 0,
  window_start  bigint not null,
  blocked_until bigint not null default 0
);
create index if not exists vx_otp_rate_window on vx_otp_rate (window_start);

/* ── one-off repair: numbers stored before canonicalisation ───────────── */

-- normalisePhone() now turns a "00" prefix into "+" and strips a leading zero, because an
-- E.164 country code never starts with 0: without this, "+06591234567" and "+6591234567"
-- were two accounts for one handset, each with its own code-sending budget. Numbers stored
-- by the older, looser form are rewritten here so those accounts are still found by phone.
--
-- Safe to re-run: every statement is a no-op once the rows are canonical.

-- A stale duplicate has to go first, or the update below would collide on the primary key.
-- The canonical row wins.
delete from vx_phones a
 where a.phone ~ '^0'
   and exists (select 1 from vx_phones b where b.phone = ltrim(a.phone, '0'));

update vx_phones
   set phone = ltrim(regexp_replace(phone, '\D', '', 'g'), '0')
 where phone <> ltrim(regexp_replace(phone, '\D', '', 'g'), '0');

update vx_users
   set phone = '+' || ltrim(regexp_replace(phone, '\D', '', 'g'), '0')
 where phone is not null
   and phone <> '+' || ltrim(regexp_replace(phone, '\D', '', 'g'), '0');

/* ── email as an account field ────────────────────────────────────────── */

-- Optional, but unique when present, and stored lowercase: people type addresses in mixed
-- case and "A@x.com" reaches the same mailbox as "a@x.com", so treating them as two
-- accounts would be a bug rather than a feature.
alter table vx_users add column if not exists email text;

-- Partial so it constrains only rows that have an address — accounts created before this
-- column existed stay valid — and case-insensitive so the uniqueness matches the storage.
create unique index if not exists vx_users_email_unique
  on vx_users (lower(email))
  where email is not null;

/* ── view-once media ──────────────────────────────────────────────────── */

-- A view-once photo or voice note is only view-once if the bytes cannot be fetched again.
-- This flag is what makes /api/media/<id> refuse to serve the media without a token, so the
-- URL in a chat payload is not enough on its own.
alter table vx_media add column if not exists once boolean not null default false;

-- The same flag on the message, so the UI knows to draw a placeholder instead of the media.
alter table vx_messages add column if not exists once boolean not null default false;

-- Who has opened what. The composite primary key *is* the enforcement: the second open
-- attempts an insert that conflicts, so it is refused rather than counted twice.
create table if not exists vx_msg_views (
  message_id text not null,
  user_id    text not null,
  viewed_at  bigint not null,
  primary key (message_id, user_id)
);

/* ── structured message payloads ──────────────────────────────────────── */

-- A shared location or contact card has no media, so what it carries lives here:
-- { lat, lng } (and an optional label) for 'location', { name, phone } for 'contact'.
-- Every other message type leaves this null.
alter table vx_messages add column if not exists payload jsonb;

/* ── linked devices ───────────────────────────────────────────────────── */

-- One row per device signed in to an account. The session cookie carries the device id, so
-- a revocation can end that session on its next request instead of leaving a stolen device
-- signed in until the cookie expires.
--
-- `revoked_at` is the whole of a logout: the row and its history stay, but the device is no
-- longer signed in. Sessions issued before devices existed carry no id at all and are not
-- represented here.
create table if not exists vx_devices (
  id         text primary key,
  user_id    text not null,
  label      text,
  user_agent text,
  ip         text,
  created_at bigint not null,
  last_seen  bigint not null,
  revoked_at bigint
);

/* ── linking a device by code ─────────────────────────────────────────── */

-- A short code shown on a device that is signed in and typed on one that is not. `code` is
-- the primary key, so `... where code = $1` is a single-row lookup.
--
-- `consumed_at` is what makes redemption single-use: the atomic update only matches while it
-- is null, so two simultaneous attempts cannot both win. The row is kept after use as an
-- audit trail, and only ever one code per account is live: minting a new one marks the old
-- row consumed. `consumed_agent` records which device spent it.
create table if not exists vx_link_codes (
  code           text primary key,
  user_id        text not null,
  created_at     bigint not null,
  expires_at     bigint not null,
  consumed_at    bigint,
  consumed_agent text
);

/* ── updates (status) ─────────────────────────────────────────────────── */

-- A short-lived post: one row per update, and every read filters on `expires_at`, so a row
-- that has passed its 24 hours is simply invisible everywhere. Nothing deletes it on a
-- schedule — the filter is what makes it short-lived, and a row survives only as history.
--
-- `kind` is 'text' or 'image'. A text update stores no media and carries `bg` (one of the
-- composer's dark swatches) so it still renders as a coloured card, while a photo update
-- stores `media_url` and may carry a caption in `text`.
--
-- Keep semicolons out of these notes. db/schema.sql is split on `;` by scripts/db-apply.mjs,
-- and a stray one inside a comment cuts the statement in half. The splitter now strips line
-- comments first, but a comment that cannot break the file is better than one that merely
-- survives it.
create table if not exists vx_status (
  id         text primary key,
  user_id    text not null,
  kind       text not null,
  text       text,
  media_url  text,
  bg         text,
  created_at bigint not null,
  expires_at bigint not null
);

-- Every feed read filters on expiry, so this is the index that matters.
create index if not exists vx_status_expires on vx_status (expires_at);

/* ── who has viewed an update ─────────────────────────────────────────── */

-- One row per viewer per update. The primary key is what makes "mark as seen" idempotent —
-- the insert is an `on conflict do nothing`, so re-opening an item writes nothing. These rows
-- are also what the author's own "viewed by" list is built from, which is why the route that
-- reads them is restricted to the update's author.
create table if not exists vx_status_views (
  status_id text not null,
  viewer_id text not null,
  viewed_at bigint not null,
  primary key (status_id, viewer_id)
);

/* ── channels (broadcast) ─────────────────────────────────────────────── */

-- A one-to-many broadcast: one owner, many followers, and only the owner writes to it.
-- `avatar` is an upload URL like any other, and `description` is the line shown under the
-- name wherever a channel is offered for following.
create table if not exists vx_channels (
  id          text primary key,
  owner_id    text not null,
  name        text not null,
  description text,
  avatar      text,
  created_at  bigint not null
);

-- The sidebar asks for "the channels I own" often enough to be worth an index of its own.
create index if not exists vx_channels_owner on vx_channels (owner_id);

/* ── who follows a channel ────────────────────────────────────────────── */

-- One row per follower, and the owner is a follower of their own channel from the moment it
-- is created — that keeps every read (the follower count, "channels I follow") to one rule
-- instead of an owner-shaped special case everywhere.
--
-- `last_read_at` is this user's high-water mark, the same idea as vx_reads for conversations:
-- the unread count of a channel is the number of posts newer than it, derived on read rather
-- than stored, so it cannot drift away from the posts it describes.
create table if not exists vx_channel_follows (
  channel_id   text not null,
  user_id      text not null,
  followed_at  bigint not null,
  last_read_at bigint not null default 0,
  primary key (channel_id, user_id)
);

-- The list of channels one user follows is a lookup by user, not by channel.
create index if not exists vx_channel_follows_user on vx_channel_follows (user_id);

/* ── channel posts ────────────────────────────────────────────────────── */

-- A post takes a `channel_id` on its own table rather than reusing vx_messages: a message
-- carries conversation semantics — replyTo, view-once, per-recipient delivery status, an
-- author who is one of two equals — none of which describes a broadcast. `kind` is 'text'
-- or 'image'. An image post stores `media_url` and may carry a caption in `text`.
create table if not exists vx_channel_posts (
  id         text primary key,
  channel_id text not null,
  author_id  text not null,
  kind       text not null,
  text       text,
  media_url  text,
  created_at bigint not null
);

-- Every read of a channel is "its latest posts", so the index carries the ordering too.
create index if not exists vx_channel_posts_channel on vx_channel_posts (channel_id, created_at desc);

/* ── calls (voice and video) ──────────────────────────────────────────── */

-- One row per 1:1 call. There is no WebSocket anywhere in this app, so a call is not a live
-- connection but a row that both sides poll: the caller inserts it as 'ringing', the other
-- side turns it into 'accepted' or 'declined', and either side ends it. `kind` is 'audio' or
-- 'video'. `status` is 'ringing', 'accepted', 'declined', 'ended' or 'missed'.
--
-- Nothing sweeps a call that is never answered. The 45 second ringing window is a filter
-- applied when the row is read, exactly the way an expired status is filtered rather than
-- deleted: a 'ringing' row older than the window reads as missed, which is what stops it
-- blocking the next call and what the history shows.
--
-- `ended_by` records who hung up, so a row can say who ended it without a second table.
-- `answered_at` stays null until the call is picked up, and the duration is derived from it
-- and `ended_at` on read rather than stored, so it cannot disagree with them.
create table if not exists vx_calls (
  id          text primary key,
  caller_id   text not null,
  callee_id   text not null,
  kind        text not null,
  status      text not null,
  created_at  bigint not null,
  answered_at bigint,
  ended_at    bigint,
  ended_by    text
);

-- The incoming-call poll asks "is there a live call for me", which is a lookup by callee and
-- status. The caller's own side is looked up by id and ordered by time.
create index if not exists vx_calls_callee on vx_calls (callee_id, status);
create index if not exists vx_calls_caller on vx_calls (caller_id, created_at desc);

/* ── call signals (the signalling channel) ────────────────────────────── */

-- WebRTC needs three things to cross between the two browsers: an offer, an answer, and a
-- stream of ICE candidates. With no WebSocket, each one is a row here and the other side
-- reads it by cursor: `seq` is monotonic, so a poll asks for everything after the last one
-- it has seen. `kind` is 'offer', 'answer' or 'candidate', and `payload` is the stringified
-- SDP or candidate. Rows are worthless once the call is over and are never read again.
create table if not exists vx_call_signals (
  seq        bigserial primary key,
  call_id    text not null,
  from_id    text not null,
  kind       text not null,
  payload    text not null,
  created_at bigint not null
);

-- Reading is always "the signals for this call, after this cursor".
create index if not exists vx_call_signals_call on vx_call_signals (call_id, seq);
