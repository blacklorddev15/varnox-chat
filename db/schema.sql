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
