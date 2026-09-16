import crypto from 'node:crypto';
import { cached, invalidate } from './cache';
import { normaliseEmail } from './email';
import { newId, rand } from './ids';
import { q } from './pg';
import { looksLikePhone, phoneKey } from './phone';
import type {
  Call,
  CallSignal,
  Channel,
  ChannelFollower,
  ChannelPost,
  ChatPrefs,
  Conv,
  ConvType,
  Device,
  Invite,
  MemberMarker,
  Message,
  MessagePayload,
  MsgOp,
  PublicUser,
  Reaction,
  StarredItem,
  Status,
  StatusAuthor,
  StatusViewer,
  User,
  UserSettings,
  WhatsAppPairing,
  WhatsAppSession,
} from './types';

/**
 * The datastore.
 *
 * This used to be Vercel Blob, where every mutation wrote a NEW uniquely-named blob and
 * readers took the newest version under a prefix, because an overwritten blob kept
 * serving stale bytes from the CDN. That scheme had two consequences: an unbounded
 * number of blobs (presence heartbeats alone wrote one every 45 seconds, forever) and a
 * very high operation count, which is what got the Blob store suspended on the Hobby
 * plan.
 *
 * Postgres has neither problem, so every "newest version wins" file is now a single row
 * that gets updated in place. The exported function signatures are unchanged, so the API
 * routes and the UI were not touched.
 */

export function inverseStamp(at: number): string {
  return String(9_999_999_999_999 - at).padStart(13, '0');
}

/* ── users ─────────────────────────────────────────────────────────────── */

type UserRow = {
  id: string;
  username: string;
  phone: string | null;
  email: string | null;
  display_name: string;
  about: string;
  avatar: string | null;
  pw_hash: string;
  created_at: number;
  last_seen: number;
};

function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    phone: r.phone ?? null,
    email: r.email ?? null,
    displayName: r.display_name,
    about: r.about ?? '',
    avatar: r.avatar ?? null,
    pwHash: r.pw_hash,
    createdAt: Number(r.created_at),
    lastSeen: Number(r.last_seen),
  };
}

/**
 * Projection for people who are *not* the account holder — search results today.
 *
 * The address is deliberately null: it is a login credential, not a published contact
 * detail, so it is only ever returned to the owner themselves (see publicUser in lib/auth
 * and presentMember with isSelf).
 */
function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    phone: u.phone ?? null,
    email: null,
    displayName: u.displayName,
    about: u.about,
    avatar: u.avatar,
    lastSeen: u.lastSeen,
  };
}

export async function getUser(id: string): Promise<User | null> {
  if (!id) return null;
  return cached(`u:${id}`, 4_000, async () => {
    const rows = await q<UserRow>('select * from vx_users where id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  });
}

export async function saveUser(user: User): Promise<void> {
  await q(
    `insert into vx_users
       (id, username, phone, display_name, about, avatar, pw_hash, created_at, last_seen, email)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (id) do update set
       username = excluded.username,
       phone = excluded.phone,
       display_name = excluded.display_name,
       about = excluded.about,
       avatar = excluded.avatar,
       pw_hash = excluded.pw_hash,
       last_seen = excluded.last_seen,
       email = excluded.email`,
    [
      user.id,
      user.username,
      user.phone ?? null,
      user.displayName,
      user.about ?? '',
      user.avatar ?? null,
      user.pwHash,
      user.createdAt,
      user.lastSeen,
      user.email ?? null,
    ]
  );
  invalidate(`u:${user.id}`);
}

/**
 * Look an account up by address.
 *
 * Matches on lower(email) so the query uses the same rule as the unique index — comparing
 * the raw column would let "A@x.com" miss the account stored as "a@x.com" and create a
 * duplicate that the index then rejects with a raw database error.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;
  const rows = await q<{ id: string }>(
    'select id from vx_users where lower(email) = $1 limit 1',
    [normalised]
  );
  return rows[0] ? getUser(rows[0].id) : null;
}

export async function emailTaken(email: string): Promise<boolean> {
  const normalised = normaliseEmail(email);
  if (!normalised) return false;
  const rows = await q('select 1 from vx_users where lower(email) = $1 limit 1', [normalised]);
  return rows.length > 0;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const rows = await q<{ user_id: string }>(
    'select user_id from vx_usernames where username = $1',
    [username.trim().toLowerCase()]
  );
  if (!rows[0]?.user_id) return null;
  return getUser(rows[0].user_id);
}

export async function usernameTaken(username: string): Promise<boolean> {
  const rows = await q('select 1 from vx_usernames where username = $1 limit 1', [
    username.trim().toLowerCase(),
  ]);
  return rows.length > 0;
}

export async function reserveUsername(username: string, userId: string): Promise<void> {
  await q(
    `insert into vx_usernames (username, user_id, created_at)
     values ($1, $2, $3)
     on conflict (username) do update set user_id = excluded.user_id`,
    [username.trim().toLowerCase(), userId, Date.now()]
  );
}

/**
 * Find people to start a chat with.
 *
 * Three ways in, because people identify each other in three different ways: an exact
 * phone number (with the country code, as stored), a username prefix, and — the one that
 * matters most in practice — their display name. Accounts created from a phone number get
 * a generated handle like "vx00000001", so a person's real name is the only thing anyone
 * can reasonably be expected to type.
 */
export async function searchUsers(term: string, excludeId: string): Promise<PublicUser[]> {
  const raw = term.trim();
  if (raw.length < 1) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (id === excludeId || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  // Escape LIKE wildcards so a search for "a_b" cannot match "axb".
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  const prefix = escape(raw.toLowerCase()) + '%';
  const contains = '%' + escape(raw.toLowerCase()) + '%';

  // Handles first: typing a handle is the most precise thing a user can do, so an exact
  // hit should not be pushed below a loose name match.
  const byHandle = await q<{ user_id: string }>(
    'select user_id from vx_usernames where username like $1 order by username limit 12',
    [prefix]
  );
  for (const r of byHandle) add(r.user_id);

  // Then names, most recently active first. Capped either way: without a limit, a
  // one-character query would walk the whole user table.
  const byDisplayName = await q<{ id: string }>(
    `select id from vx_users
      where id <> $1 and display_name ilike $2
      order by last_seen desc
      limit 12`,
    [excludeId, contains]
  );
  for (const r of byDisplayName) add(r.id);

  if (looksLikePhone(raw)) {
    const byPhone = await getUserByPhone(raw);
    if (byPhone) add(byPhone.id);
  }

  const users = await Promise.all(ids.slice(0, 12).map((id) => getUser(id)));
  return users.filter((u): u is User => Boolean(u)).map(toPublicUser);
}

/**
 * Everyone else here, most recently active first.
 *
 * This is the directory shown before anything is typed. A new account has no chats, so
 * without it the app looks empty even when other people have signed up — which is exactly
 * the complaint that prompted it. Deliberately capped: an unbounded list would be a user
 * dump with a search box in front of it.
 */
export async function listUsers(excludeId: string, limit = 50): Promise<PublicUser[]> {
  const rows = await q<{ id: string }>(
    'select id from vx_users where id <> $1 order by last_seen desc limit $2',
    [excludeId, limit]
  );
  const users = await Promise.all(rows.map((r) => getUser(r.id)));
  return users.filter((u): u is User => Boolean(u)).map(toPublicUser);
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  const rows = await q<{ user_id: string }>('select user_id from vx_phones where phone = $1', [
    phoneKey(phone),
  ]);
  if (!rows[0]?.user_id) return null;
  return getUser(rows[0].user_id);
}

export async function phoneTaken(phone: string): Promise<boolean> {
  const rows = await q('select 1 from vx_phones where phone = $1 limit 1', [phoneKey(phone)]);
  return rows.length > 0;
}

export async function reservePhone(phone: string, userId: string): Promise<void> {
  // do nothing, not do update: a reservation must never be silently reassigned to another
  // account. Callers that intend to move a number release it first (see PATCH /api/me).
  await q(
    `insert into vx_phones (phone, user_id) values ($1, $2)
     on conflict (phone) do nothing`,
    [phoneKey(phone), userId]
  );
}

/** Release a number so it can be claimed by another account. */
export async function releasePhone(phone: string): Promise<void> {
  await q('delete from vx_phones where phone = $1', [phoneKey(phone)]);
}

/* ── conversations ─────────────────────────────────────────────────────── */

type ConvRow = {
  id: string;
  type: string;
  name: string;
  avatar: string | null;
  members: string[];
  admins: string[];
  created_by: string;
  created_at: number;
  disappear_sec: number;
};

function toConv(r: ConvRow): Conv {
  return {
    id: r.id,
    type: r.type as ConvType,
    name: r.name ?? '',
    avatar: r.avatar ?? null,
    members: r.members ?? [],
    admins: r.admins ?? [],
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    disappearSec: r.disappear_sec ?? 0,
  };
}

export async function getConv(id: string): Promise<Conv | null> {
  if (!id) return null;
  return cached(`c:${id}`, 5_000, async () => {
    const rows = await q<ConvRow>('select * from vx_convs where id = $1', [id]);
    return rows[0] ? toConv(rows[0]) : null;
  });
}

export async function saveConv(conv: Conv): Promise<void> {
  await q(
    `insert into vx_convs
       (id, type, name, avatar, members, admins, created_by, created_at, disappear_sec)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       type = excluded.type,
       name = excluded.name,
       avatar = excluded.avatar,
       members = excluded.members,
       admins = excluded.admins,
       disappear_sec = excluded.disappear_sec`,
    [
      conv.id,
      conv.type,
      conv.name ?? '',
      conv.avatar ?? null,
      JSON.stringify(conv.members ?? []),
      JSON.stringify(conv.admins ?? []),
      conv.createdBy,
      conv.createdAt,
      conv.disappearSec ?? 0,
    ]
  );
  invalidate(`c:${conv.id}`);
}

type MarkerRow = {
  user_id: string;
  conv_id: string;
  conv_name: string;
  conv_type: string;
  conv_avatar: string | null;
  at: number;
  last: MemberMarker['last'];
  is_left: boolean;
};

function toMarker(r: MarkerRow): MemberMarker {
  return {
    convId: r.conv_id,
    userId: r.user_id,
    convName: r.conv_name ?? '',
    convType: r.conv_type as ConvType,
    convAvatar: r.conv_avatar ?? null,
    at: Number(r.at),
    last: r.last ?? null,
    left: r.is_left ? true : undefined,
  };
}

/**
 * Upsert, so the latest write wins.
 *
 * The Blob version kept every write and picked the row with the largest `at`, which
 * meant `hideConvFor` (which writes with the conversation's createdAt) could never
 * actually hide a chat you had since exchanged messages in. Writing state directly
 * fixes that, and the callers all pass monotonically increasing timestamps, so sidebar
 * ordering is unaffected.
 */
export async function putMarker(marker: MemberMarker): Promise<void> {
  await q(
    `insert into vx_markers
       (user_id, conv_id, conv_name, conv_type, conv_avatar, at, last, is_left)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, conv_id) do update set
       conv_name = excluded.conv_name,
       conv_type = excluded.conv_type,
       conv_avatar = excluded.conv_avatar,
       at = excluded.at,
       last = excluded.last,
       is_left = excluded.is_left`,
    [
      marker.userId,
      marker.convId,
      marker.convName ?? '',
      marker.convType,
      marker.convAvatar ?? null,
      marker.at,
      marker.last ? JSON.stringify(marker.last) : null,
      Boolean(marker.left),
    ]
  );
  invalidate(`uc:${marker.userId}`);
}

/** Newest marker per conversation for one user, most recent first. */
export async function listMarkers(
  userId: string,
  opts: { includeLeft?: boolean } = {}
): Promise<MemberMarker[]> {
  // The unfiltered set is what gets cached, so an includeLeft call cannot be served a
  // filtered list (and vice versa).
  const all = await cached(`uc:${userId}`, 2_000, async () => {
    const rows = await q<MarkerRow>(
      `select user_id, conv_id, conv_name, conv_type, conv_avatar, at, last, is_left
       from vx_markers where user_id = $1 order by at desc`,
      [userId]
    );
    return rows.map(toMarker);
  });
  return opts.includeLeft ? all : all.filter((m) => !m.left);
}

/* ── messages ──────────────────────────────────────────────────────────── */

type MessageRow = {
  id: string;
  conv_id: string;
  sender_id: string;
  sender_name: string;
  at: number;
  type: string;
  text: string;
  media_url: string | null;
  media_w: number | null;
  media_h: number | null;
  audio_sec: number | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  forwarded: boolean;
  once: boolean;
  payload: MessagePayload | null;
  reply_to: Message['replyTo'];
};

/**
 * Optional fields are omitted rather than set to null, matching the JSON documents the
 * Blob version stored, so nothing downstream starts seeing nulls where it used to see
 * an absent key.
 */
function toMessage(r: MessageRow): Message {
  const msg: Message = {
    id: r.id,
    convId: r.conv_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    at: Number(r.at),
    type: r.type as Message['type'],
    text: r.text ?? '',
  };
  if (r.media_url != null) msg.mediaUrl = r.media_url;
  if (r.media_w != null) msg.mediaW = Number(r.media_w);
  if (r.media_h != null) msg.mediaH = Number(r.media_h);
  if (r.audio_sec != null) msg.audioSec = Number(r.audio_sec);
  if (r.file_name != null) msg.fileName = r.file_name;
  if (r.file_size != null) msg.fileSize = Number(r.file_size);
  if (r.mime != null) msg.mime = r.mime;
  if (r.forwarded) msg.forwarded = true;
  if (r.once) msg.once = true;
  // jsonb arrives already parsed, so this is passed through rather than re-parsed.
  if (r.payload != null) msg.payload = r.payload;
  if (r.reply_to != null) msg.replyTo = r.reply_to;
  return msg;
}

export async function saveMessage(msg: Message): Promise<void> {
  await q(
    `insert into vx_messages
       (id, conv_id, sender_id, sender_name, at, type, text, media_url, media_w, media_h,
        audio_sec, file_name, file_size, mime, forwarded, reply_to, once, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     on conflict (id) do update set
       text = excluded.text,
       media_url = excluded.media_url,
       media_w = excluded.media_w,
       media_h = excluded.media_h,
       audio_sec = excluded.audio_sec,
       file_name = excluded.file_name,
       file_size = excluded.file_size,
       mime = excluded.mime,
       forwarded = excluded.forwarded,
       reply_to = excluded.reply_to,
       once = excluded.once,
       payload = excluded.payload`,
    [
      msg.id,
      msg.convId,
      msg.senderId,
      msg.senderName,
      msg.at,
      msg.type,
      msg.text ?? '',
      msg.mediaUrl ?? null,
      msg.mediaW ?? null,
      msg.mediaH ?? null,
      msg.audioSec ?? null,
      msg.fileName ?? null,
      msg.fileSize ?? null,
      msg.mime ?? null,
      Boolean(msg.forwarded),
      msg.replyTo ? JSON.stringify(msg.replyTo) : null,
      Boolean(msg.once),
      msg.payload ? JSON.stringify(msg.payload) : null,
    ]
  );
  invalidate(`m:${msg.convId}`);
}

/** One message by id, for the view-once path. Not cached: it is read once per open. */
export async function getMessage(id: string): Promise<Message | null> {
  if (!id) return null;
  const rows = await q<MessageRow>('select * from vx_messages where id = $1', [id]);
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Claim the single view of a message for this user.
 *
 * The primary key on (message_id, user_id) does the work: a second attempt conflicts and
 * inserts nothing, so exactly one caller can ever be told it succeeded. A read-then-write
 * would let two concurrent opens both believe they were first.
 */
export async function claimMessageView(messageId: string, userId: string): Promise<boolean> {
  const rows = await q(
    `insert into vx_msg_views (message_id, user_id, viewed_at)
     values ($1, $2, $3)
     on conflict (message_id, user_id) do nothing
     returning message_id`,
    [messageId, userId, Date.now()]
  );
  return rows.length > 0;
}

/** Which of these messages each user has already opened, keyed by message id. */
export async function getMessageViews(
  messageIds: string[]
): Promise<Record<string, string[]>> {
  if (!messageIds.length) return {};
  const rows = await q<{ message_id: string; user_id: string }>(
    'select message_id, user_id from vx_msg_views where message_id = any($1::text[])',
    [messageIds]
  );
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    (map[r.message_id] ??= []).push(r.user_id);
  }
  return map;
}

type OpRow = { msg_id: string; conv_id: string; op: string; text: string | null; at: number };

export async function getMessageOps(convId: string): Promise<Record<string, MsgOp>> {
  return cached(`mo:${convId}`, 4_000, async () => {
    const rows = await q<OpRow>(
      'select msg_id, conv_id, op, text, at from vx_msg_ops where conv_id = $1',
      [convId]
    );
    const map: Record<string, MsgOp> = {};
    for (const r of rows) {
      map[r.msg_id] = {
        convId: r.conv_id,
        msgId: r.msg_id,
        op: r.op as MsgOp['op'],
        ...(r.text != null ? { text: r.text } : {}),
        at: Number(r.at),
      };
    }
    return map;
  });
}

export async function saveMessageOp(op: MsgOp): Promise<void> {
  await q(
    `insert into vx_msg_ops (msg_id, conv_id, op, text, at)
     values ($1, $2, $3, $4, $5)
     on conflict (msg_id) do update set
       op = excluded.op,
       text = excluded.text,
       at = excluded.at
     where excluded.at >= vx_msg_ops.at`,
    [op.msgId, op.convId, op.op, op.text ?? null, op.at]
  );
  invalidate(`mo:${op.convId}`);
}

/**
 * Page cursor. The Blob version used an opaque storage cursor; here it encodes the last
 * row of the page as "at_id", which is exactly what the next page continues from.
 */
function encodeCursor(at: number, id: string): string {
  return `${at}_${id}`;
}

function decodeCursor(cursor: string): { at: number; id: string } | null {
  const cut = cursor.indexOf('_');
  if (cut < 1) return null;
  const at = Number(cursor.slice(0, cut));
  const id = cursor.slice(cut + 1);
  if (!Number.isFinite(at) || !id) return null;
  return { at, id };
}

/**
 * Messages of a conversation, newest first from storage.
 * `since` returns only messages strictly newer than that timestamp.
 */
export async function getMessages(
  convId: string,
  opts: { limit?: number; cursor?: string; since?: number; hideBefore?: number } = {}
): Promise<{ messages: Message[]; cursor?: string; hasMore: boolean }> {
  const limit = Math.min(opts.limit ?? 40, 200);
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;

  const params: unknown[] = [convId];
  let where = 'conv_id = $1';
  if (after) {
    params.push(after.at, after.id);
    where += ` and (at, id) < ($2, $3)`;
  }
  // Fetch one extra row so hasMore is known without a second query.
  params.push(limit + 1);

  const rows = await q<MessageRow>(
    `select * from vx_messages where ${where} order by at desc, id desc limit $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const tail = page[page.length - 1];
  const cursor = tail ? encodeCursor(Number(tail.at), tail.id) : undefined;

  let msgs = page.map(toMessage);
  if (opts.since) {
    const since = opts.since;
    msgs = msgs.filter((m) => m.at > since);
  }

  const ops = await getMessageOps(convId);
  const clean: Message[] = [];
  for (const m of msgs) {
    if (opts.hideBefore && m.at < opts.hideBefore) continue;
    const op = ops[m.id];
    if (op?.op === 'delete') continue;
    if (op?.op === 'edit' && op.text !== undefined) clean.push({ ...m, text: op.text });
    else clean.push(m);
  }
  clean.sort((a, b) => a.at - b.at);
  return { messages: clean, cursor, hasMore };
}

export async function messagesSince(convId: string, since: number): Promise<Message[]> {
  const res = await getMessages(convId, { limit: 60, since });
  return res.messages;
}

export async function lastMessage(convId: string): Promise<Message | null> {
  // Deliberately does not apply edit/delete ops, matching the previous behaviour: this
  // feeds the sidebar preview, which is written at send time and not rewritten by ops.
  const rows = await q<MessageRow>(
    'select * from vx_messages where conv_id = $1 order by at desc, id desc limit 1',
    [convId]
  );
  return rows[0] ? toMessage(rows[0]) : null;
}

/** Unread count for one conversation: messages after `since` not sent by me. */
export async function countUnread(convId: string, userId: string, since: number): Promise<number> {
  const rows = await q<{ n: number }>(
    `select count(*)::int as n from vx_messages
     where conv_id = $1 and at > $2 and sender_id <> $3`,
    [convId, since, userId]
  );
  return rows[0]?.n ?? 0;
}

/* ── read state ────────────────────────────────────────────────────────── */

export async function getReads(userId: string): Promise<Record<string, number>> {
  const rows = await q<{ conv_id: string; at: number }>(
    'select conv_id, at from vx_reads where user_id = $1',
    [userId]
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.conv_id] = Number(r.at);
  return out;
}

/**
 * Record that a user has read up to `at`.
 * `shareReceipt: false` keeps the value private to the reader (used when the user
 * has turned read receipts off) while still clearing their own unread badge.
 */
export async function markRead(
  userId: string,
  convId: string,
  at: number,
  opts: { shareReceipt?: boolean } = {}
): Promise<void> {
  const rows = await q<{ at: number }>(
    `insert into vx_reads (user_id, conv_id, at) values ($1, $2, $3)
     on conflict (user_id, conv_id) do update set at = greatest(vx_reads.at, excluded.at)
     returning at`,
    [userId, convId, at]
  );
  const next = Number(rows[0]?.at ?? at);
  if (opts.shareReceipt !== false) {
    await q(
      `insert into vx_conv_reads (conv_id, user_id, at) values ($1, $2, $3)
       on conflict (conv_id, user_id) do update set at = greatest(vx_conv_reads.at, excluded.at)`,
      [convId, userId, next]
    );
    invalidate(`r:${convId}`);
  }
  invalidate(`ur:${userId}`);
}

export async function getConvReads(convId: string): Promise<Record<string, number>> {
  return cached(`r:${convId}`, 3_000, async () => {
    const rows = await q<{ user_id: string; at: number }>(
      'select user_id, at from vx_conv_reads where conv_id = $1',
      [convId]
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.user_id] = Number(r.at);
    return map;
  });
}

/* ── aggregates ────────────────────────────────────────────────────────── */

export type ChatSummary = {
  conv: Conv;
  last: MemberMarker['last'];
  unread: number;
  readAt: number;
  updatedAt: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
};

export async function chatSummaries(userId: string): Promise<ChatSummary[]> {
  const [markers, reads, settings] = await Promise.all([
    listMarkers(userId),
    getReads(userId),
    getSettings(userId),
  ]);
  const rows = await Promise.all(
    markers.map(async (m) => {
      const conv = await getConv(m.convId);
      if (!conv) return null;
      const readAt = reads[m.convId] ?? 0;
      const unread =
        m.last && m.last.senderId !== userId && m.last.at > readAt
          ? await countUnread(m.convId, userId, readAt)
          : 0;
      const pref = settings.chatPrefs[m.convId] ?? {};
      return {
        conv,
        last: m.last,
        unread,
        readAt,
        updatedAt: m.at,
        pinned: Boolean(pref.pinned),
        muted: Boolean(pref.muted),
        archived: Boolean(pref.archived),
      } as ChatSummary;
    })
  );
  return rows
    .filter((r): r is ChatSummary => Boolean(r))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ── settings (wallpaper, notifications, privacy, per-chat prefs, blocked) ── */

export function defaultSettings(userId: string): UserSettings {
  return {
    userId,
    wallpaper: 'doodle',
    notifications: true,
    privacy: {
      lastSeen: 'everyone',
      profilePhoto: 'everyone',
      readReceipts: true,
      // Updates are visible to every signed-in user unless the account says otherwise.
      statusPrivacy: 'everyone',
    },
    chatPrefs: {},
    blocked: [],
    at: Date.now(),
  };
}

type SettingsRow = {
  user_id: string;
  wallpaper: string;
  notifications: boolean;
  privacy: UserSettings['privacy'] | null;
  chat_prefs: Record<string, ChatPrefs> | null;
  blocked: string[] | null;
  at: number;
};

export async function getSettings(userId: string): Promise<UserSettings> {
  const base = defaultSettings(userId);
  return cached(`set:${userId}`, 4_000, async () => {
    const rows = await q<SettingsRow>('select * from vx_settings where user_id = $1', [userId]);
    const stored = rows[0];
    if (!stored) return base;
    return {
      ...base,
      wallpaper: (stored.wallpaper as UserSettings['wallpaper']) ?? base.wallpaper,
      notifications: stored.notifications ?? base.notifications,
      privacy: { ...base.privacy, ...(stored.privacy ?? {}) },
      chatPrefs: stored.chat_prefs ?? {},
      blocked: stored.blocked ?? [],
      at: Number(stored.at) || base.at,
    };
  });
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const next = { ...settings, at: Date.now() };
  await q(
    `insert into vx_settings (user_id, wallpaper, notifications, privacy, chat_prefs, blocked, at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set
       wallpaper = excluded.wallpaper,
       notifications = excluded.notifications,
       privacy = excluded.privacy,
       chat_prefs = excluded.chat_prefs,
       blocked = excluded.blocked,
       at = excluded.at`,
    [
      next.userId,
      next.wallpaper,
      next.notifications,
      JSON.stringify(next.privacy ?? {}),
      JSON.stringify(next.chatPrefs ?? {}),
      JSON.stringify(next.blocked ?? []),
      next.at,
    ]
  );
  invalidate(`set:${next.userId}`);
  return next;
}

export async function patchSettings(
  userId: string,
  patch: Partial<Omit<UserSettings, 'userId'>>
): Promise<UserSettings> {
  const current = await getSettings(userId);
  return saveSettings({
    ...current,
    ...patch,
    privacy: { ...current.privacy, ...(patch.privacy ?? {}) },
    chatPrefs: patch.chatPrefs ?? current.chatPrefs,
    blocked: patch.blocked ?? current.blocked,
  });
}

export async function setChatPref(
  userId: string,
  convId: string,
  pref: Partial<ChatPrefs>
): Promise<UserSettings> {
  const current = await getSettings(userId);
  const merged = { ...(current.chatPrefs[convId] ?? {}), ...pref };
  return saveSettings({
    ...current,
    chatPrefs: { ...current.chatPrefs, [convId]: merged },
  });
}

export async function toggleBlocked(userId: string, otherId: string, block: boolean) {
  const current = await getSettings(userId);
  const blocked = block
    ? Array.from(new Set([...current.blocked, otherId]))
    : current.blocked.filter((id) => id !== otherId);
  return saveSettings({ ...current, blocked });
}

/* ── reactions, stars, typing, presence, invites ───────────────────────── */

export async function putReaction(reaction: Reaction): Promise<void> {
  await q(
    `insert into vx_reactions (msg_id, user_id, conv_id, emoji, at)
     values ($1, $2, $3, $4, $5)
     on conflict (msg_id, user_id) do update set
       conv_id = excluded.conv_id,
       emoji = excluded.emoji,
       at = excluded.at`,
    [reaction.msgId, reaction.userId, reaction.convId, reaction.emoji, reaction.at]
  );
  invalidate(`rx:${reaction.convId}`);
}

/** msgId -> userId -> emoji (empty reactions are dropped) */
export async function getReactions(convId: string): Promise<Record<string, Record<string, string>>> {
  return cached(`rx:${convId}`, 2_000, async () => {
    const rows = await q<{ msg_id: string; user_id: string; emoji: string }>(
      'select msg_id, user_id, emoji from vx_reactions where conv_id = $1',
      [convId]
    );
    const map: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      if (!r.emoji) continue;
      map[r.msg_id] = { ...(map[r.msg_id] ?? {}), [r.user_id]: r.emoji };
    }
    return map;
  });
}

export async function setStar(
  item: Omit<StarredItem, 'removed'> | null,
  userId: string,
  msgId: string
) {
  const payload: StarredItem = item
    ? { ...item }
    : {
        userId,
        msgId,
        convId: '',
        convName: '',
        at: Date.now(),
        removed: true,
        snapshot: { text: '', type: 'text', senderName: '', at: 0 },
      };
  await q(
    `insert into vx_starred (user_id, msg_id, conv_id, conv_name, at, removed, snapshot)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, msg_id) do update set
       conv_id = excluded.conv_id,
       conv_name = excluded.conv_name,
       at = excluded.at,
       removed = excluded.removed,
       snapshot = excluded.snapshot`,
    [
      userId,
      msgId,
      payload.convId ?? '',
      payload.convName ?? '',
      payload.at,
      Boolean(payload.removed),
      JSON.stringify(payload.snapshot ?? {}),
    ]
  );
  invalidate(`star:${userId}`);
}

export async function getStarred(userId: string): Promise<StarredItem[]> {
  return cached(`star:${userId}`, 3_000, async () => {
    const rows = await q<{
      user_id: string;
      msg_id: string;
      conv_id: string;
      conv_name: string;
      at: number;
      snapshot: StarredItem['snapshot'];
    }>(
      `select user_id, msg_id, conv_id, conv_name, at, snapshot
       from vx_starred where user_id = $1 and removed = false order by at desc`,
      [userId]
    );
    return rows.map((r) => ({
      userId: r.user_id,
      msgId: r.msg_id,
      convId: r.conv_id,
      convName: r.conv_name,
      at: Number(r.at),
      snapshot: r.snapshot,
    }));
  });
}

export async function setTyping(convId: string, userId: string): Promise<void> {
  const now = Date.now();
  await q(
    `insert into vx_typing (conv_id, user_id, at) values ($1, $2, $3)
     on conflict (conv_id, user_id) do update set at = excluded.at`,
    [convId, userId, now]
  );
  // Prune everyone whose typing state has gone stale, which the Blob version did by
  // rewriting the whole document on every ping.
  await q('delete from vx_typing where conv_id = $1 and at < $2', [convId, now - 20_000]);
}

/** userIds currently typing (activity within the last 6 seconds) */
export async function getTyping(convId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>(
    'select user_id from vx_typing where conv_id = $1 and at > $2',
    [convId, Date.now() - 6_000]
  );
  return rows.map((r) => r.user_id);
}

export async function heartbeat(userId: string): Promise<void> {
  await q(
    `insert into vx_presence (user_id, at) values ($1, $2)
     on conflict (user_id) do update set at = excluded.at`,
    [userId, Date.now()]
  );
}

export async function getPresence(userId: string): Promise<number> {
  return cached(`pr:${userId}`, 15_000, async () => {
    const rows = await q<{ at: number }>('select at from vx_presence where user_id = $1', [userId]);
    return rows[0] ? Number(rows[0].at) : 0;
  });
}

export async function getPresenceMany(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await q<{ user_id: string; at: number }>(
    'select user_id, at from vx_presence where user_id = any($1)',
    [ids]
  );
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = 0;
  for (const r of rows) out[r.user_id] = Number(r.at);
  return out;
}

export async function createInvite(convId: string, createdBy: string): Promise<Invite> {
  const invite: Invite = { code: rand(11), convId, createdBy, createdAt: Date.now() };
  await q(
    `insert into vx_invites (code, conv_id, created_by, created_at)
     values ($1, $2, $3, $4)
     on conflict (code) do update set conv_id = excluded.conv_id`,
    [invite.code, invite.convId, invite.createdBy, invite.createdAt]
  );
  return invite;
}

export async function getInvite(code: string): Promise<Invite | null> {
  if (!/^[a-z0-9]{6,20}$/.test(code)) return null;
  const rows = await q<{ code: string; conv_id: string; created_by: string; created_at: number }>(
    'select code, conv_id, created_by, created_at from vx_invites where code = $1',
    [code]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    code: r.code,
    convId: r.conv_id,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
  };
}

/* ── search across the user's own conversations ────────────────────────── */

export type SearchHit = {
  convId: string;
  convName: string;
  convType: ConvType;
  messages: { id: string; text: string; at: number; senderName: string; senderId: string }[];
};

export async function searchMessages(
  userId: string,
  query: string,
  maxConvs = 12
): Promise<SearchHit[]> {
  const q2 = query.trim().toLowerCase();
  if (q2.length < 2) return [];
  const markers = (await listMarkers(userId)).slice(0, maxConvs);
  const hits = await Promise.all(
    markers.map(async (m) => {
      const conv = await getConv(m.convId);
      if (!conv) return null;
      const { messages } = await getMessages(m.convId, { limit: 200 });
      const matched = messages
        .filter((msg) => msg.type !== 'system' && msg.text && msg.text.toLowerCase().includes(q2))
        .slice(-8)
        .map((msg) => ({
          id: msg.id,
          text: msg.text,
          at: msg.at,
          senderName: msg.senderName,
          senderId: msg.senderId,
        }));
      if (!matched.length) return null;
      return {
        convId: m.convId,
        convName: conv.type === 'group' ? conv.name : 'Direct chat',
        convType: conv.type,
        messages: matched,
      } as SearchHit;
    })
  );
  return hits.filter((h): h is SearchHit => Boolean(h));
}

/* ── phone verification (SMS one-time codes) ───────────────────────────── */

type OtpRow = {
  phone: string;
  code_hash: string;
  sent_at: number;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
};

export type Otp = {
  phone: string;
  codeHash: string;
  sentAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
};

/**
 * Store the code in flight for a number.
 *
 * One row per number: a new send replaces the previous code and resets the attempt
 * count, so an old code can never be replayed after a resend. Rows with nothing left
 * to prove are swept opportunistically here rather than by a scheduled job, because a
 * Vercel deployment has nowhere to hang one.
 */
export async function putOtp(row: {
  phone: string;
  codeHash: string;
  sentAt: number;
  expiresAt: number;
  ip?: string | null;
}): Promise<void> {
  await q('delete from vx_otp where expires_at < $1', [row.sentAt - 86_400_000]);
  await q(
    `insert into vx_otp (phone, code_hash, sent_at, expires_at, attempts, consumed_at, sent_ip)
     values ($1, $2, $3, $4, 0, null, $5)
     on conflict (phone) do update set
       code_hash = excluded.code_hash,
       sent_at = excluded.sent_at,
       expires_at = excluded.expires_at,
       attempts = 0,
       consumed_at = null,
       sent_ip = excluded.sent_ip`,
    [phoneKey(row.phone), row.codeHash, row.sentAt, row.expiresAt, row.ip ?? null]
  );
}

export async function getOtp(phone: string): Promise<Otp | null> {
  const rows = await q<OtpRow>('select * from vx_otp where phone = $1', [phoneKey(phone)]);
  const r = rows[0];
  if (!r) return null;
  return {
    phone: r.phone,
    codeHash: r.code_hash,
    sentAt: Number(r.sent_at),
    expiresAt: Number(r.expires_at),
    attempts: Number(r.attempts),
    consumedAt: r.consumed_at === null ? null : Number(r.consumed_at),
  };
}

/**
 * Spend one guess from the code's allowance, atomically, and return the new count.
 *
 * Returns null when there is nothing left to guess at — the row is gone, the code is
 * consumed or expired, or the allowance is used up. Claiming the guess *before* comparing
 * is what stops a concurrent burst: with a read-then-write, N simultaneous attempts all
 * observe the same count and all get hashed, so one code would absorb far more than
 * OTP_MAX_ATTEMPTS guesses and the six-digit space stops being safe.
 */
export async function claimOtpAttempt(
  phone: string,
  now: number,
  max: number
): Promise<number | null> {
  const rows = await q<{ attempts: number }>(
    `update vx_otp set attempts = attempts + 1
     where phone = $1 and consumed_at is null and expires_at > $2 and attempts < $3
     returning attempts`,
    [phoneKey(phone), now, max]
  );
  return rows[0] ? Number(rows[0].attempts) : null;
}

/**
 * Claim the code. The update only matches while the row is still unconsumed, so of N
 * concurrent verifications carrying the same correct code exactly one wins and the rest
 * are told it was already used — a read-then-write would let every caller through and one
 * code would mint several sessions.
 *
 * The row is kept for the audit trail rather than deleted.
 */
export async function consumeOtp(phone: string): Promise<boolean> {
  const rows = await q(
    'update vx_otp set consumed_at = $2 where phone = $1 and consumed_at is null returning phone',
    [phoneKey(phone), Date.now()]
  );
  return rows.length > 0;
}

/**
 * Hand a code back when the sign-in that followed it failed, so it is not burnt for nothing.
 *
 * Scoped by `codeHash`, not just the number: between the consume and this call a resend
 * could have replaced the row with a fresh code, and a phone-wide update would revive that
 * newer code — possibly after somebody else had already signed in with it, which is exactly
 * the one-code-one-session property the atomic consume exists to protect.
 */
export async function unconsumeOtp(phone: string, codeHash: string): Promise<void> {
  await q(
    'update vx_otp set consumed_at = null where phone = $1 and code_hash = $2 and expires_at > $3',
    [phoneKey(phone), codeHash, Date.now()]
  );
}

export async function clearOtp(phone: string): Promise<void> {
  await q('delete from vx_otp where phone = $1', [phoneKey(phone)]);
}

export type RateSlot = {
  allowed: boolean;
  count: number;
  /** Milliseconds until the caller may try again (0 when allowed). */
  retryAfterMs: number;
};

/**
 * Take one slot from a fixed-window bucket, atomically.
 *
 * This is what stops someone turning the login form into an SMS cannon, where every
 * request costs real money at the provider. Window and limit are per caller — per
 * number, per IP — and a bucket that runs out stays blocked until its window ends.
 *
 * It is a single statement with `on conflict ... returning`, so two concurrent requests
 * cannot both read the same stale count and each conclude they are within the limit.
 * While a bucket is already blocked its counter is left alone and the original
 * `blocked_until` is preserved, so hammering it cannot extend its own lockout.
 */
export async function takeRateSlot(
  bucket: string,
  windowMs: number,
  limit: number,
  now = Date.now()
): Promise<RateSlot> {
  const rows = await q<{ count: number; blocked_until: number }>(
    `insert into vx_otp_rate (bucket, count, window_start, blocked_until)
     values ($1, 1, $2, 0)
     on conflict (bucket) do update set
       count = case
         when vx_otp_rate.blocked_until > $2 then vx_otp_rate.count
         when vx_otp_rate.window_start + $3 <= $2 then 1
         else vx_otp_rate.count + 1 end,
       window_start = case
         when vx_otp_rate.blocked_until > $2 then vx_otp_rate.window_start
         when vx_otp_rate.window_start + $3 <= $2 then $2
         else vx_otp_rate.window_start end,
       blocked_until = case
         when vx_otp_rate.blocked_until > $2 then vx_otp_rate.blocked_until
         when (case
                 when vx_otp_rate.window_start + $3 <= $2 then 1
                 else vx_otp_rate.count + 1 end) > $4
           then (case
                   when vx_otp_rate.window_start + $3 <= $2 then $2
                   else vx_otp_rate.window_start end) + $3
         else 0 end
     returning count, blocked_until`,
    [bucket, now, windowMs, limit]
  );

  const row = rows[0];
  if (!row) return { allowed: true, count: 0, retryAfterMs: 0 };
  const blockedUntil = Number(row.blocked_until);
  if (blockedUntil > now) {
    return { allowed: false, count: Number(row.count), retryAfterMs: blockedUntil - now };
  }
  return { allowed: true, count: Number(row.count), retryAfterMs: 0 };
}
/**
 * Resolve an account by number, falling back to the column on vx_users.
 *
 * vx_phones is the authority on "taken", and login goes through that index — but an
 * account whose reservation is missing (written before phone login existed, or by a
 * direct edit) still has to be found. Without this fallback a code login would create a
 * second account for a number that already has one, and both would be able to sign in.
 */
export async function findUserByPhone(phone: string): Promise<User | null> {
  const viaIndex = await getUserByPhone(phone);
  if (viaIndex) return viaIndex;
  const rows = await q<{ id: string }>('select id from vx_users where phone = $1 limit 1', [phone]);
  return rows[0] ? getUser(rows[0].id) : null;
}

/* ── linked devices ────────────────────────────────────────────────────── */

/**
 * Linking a device: a short code is shown on an account that is already signed in, typed on
 * another device, and the second device gets a session of its own.
 *
 * The code is the only credential in that exchange, so it is short-lived, single-use, and
 * never stored in the clear beyond its two minutes. Each device gets a row and the session
 * carries its id, which is what lets a device be signed out from somewhere else — see
 * isDeviceActive() and revokeDevice().
 */

/** How long a code is good for. Long enough to read off one screen and type into another. */
export const LINK_CODE_TTL_MS = 2 * 60_000;

/**
 * The alphabet a code is drawn from: A-Z and 2-9 with I, O, 0 and 1 left out, because the
 * code is read off one screen and typed into another, and those are the pairs people
 * misread. Exactly thirty-two characters, so mapping a byte onto it carries no modulo bias.
 */
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Eight characters from a CSPRNG — never Math.random, which is not unpredictable. */
function newLinkCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const byte of bytes) out += LINK_ALPHABET[byte % LINK_ALPHABET.length];
  return out;
}

/** What is recorded about a client when it first signs in. */
type DeviceInfo = {
  label?: string | null;
  userAgent?: string | null;
  ip?: string | null;
};

type DeviceRow = {
  id: string;
  label: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  last_seen: number;
};

function toDevice(r: DeviceRow): Device {
  return {
    id: r.id,
    label: r.label ?? null,
    userAgent: r.user_agent ?? null,
    ip: r.ip ?? null,
    createdAt: Number(r.created_at),
    lastSeen: Number(r.last_seen),
    // The datastore cannot know which device is asking. The API marks that one.
    current: false,
  };
}

export async function createDevice(userId: string, info: DeviceInfo = {}): Promise<Device> {
  const now = Date.now();
  const device: Device = {
    id: newId('d'),
    label: info.label ?? null,
    userAgent: info.userAgent ?? null,
    ip: info.ip ?? null,
    createdAt: now,
    lastSeen: now,
    current: false,
  };
  await q(
    `insert into vx_devices (id, user_id, label, user_agent, ip, created_at, last_seen, revoked_at)
     values ($1, $2, $3, $4, $5, $6, $7, null)`,
    [device.id, userId, device.label, device.userAgent, device.ip, device.createdAt, device.lastSeen]
  );
  return device;
}

/** A device that is still signed in, or null once it has been revoked. */
export async function deviceById(id: string): Promise<Device | null> {
  if (!id) return null;
  const rows = await q<DeviceRow>(
    `select id, label, user_agent, ip, created_at, last_seen
       from vx_devices
      where id = $1 and revoked_at is null`,
    [id]
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

/** Every device still signed in to the account, newest first. Marking the current one is
 *  the caller's job, because only the caller can see the session cookie. */
export async function listDevices(userId: string): Promise<Device[]> {
  const rows = await q<DeviceRow>(
    `select id, label, user_agent, ip, created_at, last_seen
       from vx_devices
      where user_id = $1 and revoked_at is null
      order by created_at desc`,
    [userId]
  );
  return rows.map(toDevice);
}

/** Note that a device is still in use — called when its owner opens the device list. */
export async function touchDevice(deviceId: string): Promise<void> {
  await q('update vx_devices set last_seen = $2 where id = $1 and revoked_at is null', [
    deviceId,
    Date.now(),
  ]);
}

/**
 * Sign a device out.
 *
 * Scoped by `user_id`, so one account can never revoke a device belonging to another. The
 * cached liveness check is dropped as well, so the change takes effect on this process at
 * once rather than after the cache entry expires.
 */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const rows = await q(
    `update vx_devices set revoked_at = $3
      where id = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [deviceId, userId, Date.now()]
  );
  if (!rows.length) return false;
  invalidate(`dev:${deviceId}`);
  return true;
}

/**
 * How long a revocation may go unnoticed on a process that has just checked.
 *
 * currentUser() asks this on every authenticated request, so it is cached rather than
 * costing a database round trip each time. The trade-off is deliberate and bounded: a
 * revocation is seen everywhere within about ten seconds, and immediately on the process
 * that performed it, because revokeDevice() invalidates the entry.
 */
const DEVICE_ACTIVE_MS = 10_000;

export async function isDeviceActive(deviceId: string): Promise<boolean> {
  if (!deviceId) return false;
  return cached(`dev:${deviceId}`, DEVICE_ACTIVE_MS, async () => {
    const rows = await q('select 1 from vx_devices where id = $1 and revoked_at is null', [deviceId]);
    return rows.length > 0;
  });
}

export type LinkCode = { code: string; expiresInSec: number };

/**
 * Mint a link code for an account.
 *
 * Only one code per account is ever live: the previous one is marked consumed before the new
 * one exists, so a code read over someone's shoulder and then replaced is useless. Expired
 * rows are swept here, opportunistically, for the same reason putOtp() sweeps its own — a
 * serverless deployment has nowhere to hang a scheduled job.
 */
export async function createLinkCode(userId: string): Promise<LinkCode> {
  const now = Date.now();
  await q('delete from vx_link_codes where expires_at < $1', [now - 86_400_000]);
  await q('update vx_link_codes set consumed_at = $2 where user_id = $1 and consumed_at is null', [
    userId,
    now,
  ]);

  const code = newLinkCode();
  await q(
    `insert into vx_link_codes (code, user_id, created_at, expires_at, consumed_at, consumed_agent)
     values ($1, $2, $3, $4, null, null)`,
    [code, userId, now, now + LINK_CODE_TTL_MS]
  );
  return { code, expiresInSec: Math.round(LINK_CODE_TTL_MS / 1000) };
}

/**
 * Spend a link code and create the device it signs in.
 *
 * The update is the whole of the check: it matches only while the code is unconsumed and
 * unexpired, so of two simultaneous attempts carrying the same code exactly one changes a
 * row and the other is refused. A read-then-write would let both through, and one code would
 * sign in two devices.
 *
 * Returns null for every kind of failure — unknown, expired or already used — because the
 * caller must not be able to tell them apart.
 */
export async function redeemLinkCode(
  code: string,
  agent: DeviceInfo
): Promise<{ userId: string; deviceId: string } | null> {
  // Typed from a screen, so case and stray spaces are forgiven: the alphabet has neither.
  const cleaned = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 8) return null;

  const now = Date.now();
  const rows = await q<{ user_id: string }>(
    `update vx_link_codes
        set consumed_at = $2, consumed_agent = $3
      where code = $1 and consumed_at is null and expires_at > $2
      returning user_id`,
    [cleaned, now, agent.userAgent ?? null]
  );
  const row = rows[0];
  if (!row) return null;

  const device = await createDevice(row.user_id, agent);
  return { userId: row.user_id, deviceId: device.id };
}

/* ── updates (status) ──────────────────────────────────────────────────── */

/** How long an update stays visible. Nothing sweeps the table: expiry is a filter, not a job. */
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

type StatusRow = {
  id: string;
  user_id: string;
  kind: string;
  text: string | null;
  media_url: string | null;
  bg: string | null;
  created_at: number;
  expires_at: number;
  seen: boolean;
  view_count: number;
};

function toStatus(r: StatusRow): Status {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind === 'image' ? 'image' : 'text',
    text: r.text ?? null,
    mediaUrl: r.media_url ?? null,
    bg: r.bg ?? null,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    seen: Boolean(r.seen),
    viewCount: Number(r.view_count ?? 0),
  };
}

/**
 * `seen` and the view count come from vx_status_views joined per row, so one query answers
 * the whole feed. Counting for every row rather than only the viewer's own keeps the SQL
 * simple; the count is blanked out below for updates that are not the viewer's.
 */
const STATUS_COLUMNS = `s.*,
  exists (select 1 from vx_status_views v
           where v.status_id = s.id and v.viewer_id = $2) as seen,
  (select count(*) from vx_status_views v where v.status_id = s.id) as view_count`;

/** One update by id. An expired row reads as missing — every caller treats it as gone. */
export async function getStatus(id: string, viewerId: string): Promise<Status | null> {
  if (!id) return null;
  const rows = await q<StatusRow>(
    `select ${STATUS_COLUMNS}
       from vx_status s
      where s.id = $1 and s.expires_at > $3`,
    [id, viewerId, Date.now()]
  );
  return rows[0] ? toStatus(rows[0]) : null;
}

/** Post an update. It is live immediately and disappears 24 hours later. */
export async function createStatus(
  userId: string,
  input: {
    kind: Status['kind'];
    text?: string | null;
    mediaUrl?: string | null;
    bg?: string | null;
  }
): Promise<Status> {
  const now = Date.now();
  const status: Status = {
    id: newId('st'),
    userId,
    kind: input.kind,
    text: input.text ?? null,
    mediaUrl: input.mediaUrl ?? null,
    bg: input.bg ?? null,
    createdAt: now,
    expiresAt: now + STATUS_TTL_MS,
    // Your own update is never "unseen" to you, and nobody has watched it yet.
    seen: true,
    viewCount: 0,
  };
  await q(
    `insert into vx_status (id, user_id, kind, text, media_url, bg, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      status.id,
      status.userId,
      status.kind,
      status.text,
      status.mediaUrl,
      status.bg,
      status.createdAt,
      status.expiresAt,
    ]
  );
  return status;
}

/**
 * Ids this user already has a *direct* conversation with, derived from vx_convs.
 *
 * A group in common deliberately does not count: 'chats' means "people I chat with one to
 * one", which is the smallest audience a user can reason about without a contact list.
 */
async function directPeerIds(userId: string): Promise<string[]> {
  const rows = await q<{ members: string[] }>(
    `select members from vx_convs where type = 'direct' and members @> $1::jsonb`,
    [JSON.stringify([userId])]
  );
  const ids = new Set<string>();
  for (const row of rows) {
    for (const member of row.members ?? []) if (member !== userId) ids.add(member);
  }
  return Array.from(ids);
}

/** A stack counts as unseen while any single update in it is unviewed by the viewer. */
function isUnseen(author: StatusAuthor): boolean {
  return author.items.some((item) => !item.seen);
}

/**
 * Everything the viewer may see, grouped by author.
 *
 * Visibility, in one place:
 *  - your own group is always present, and is the only group that carries view counts;
 *  - an author whose `privacy.statusPrivacy` is 'everyone' (the default) is visible to every
 *    signed-in user;
 *  - an author who chose 'chats' is visible only to people they already have a direct
 *    conversation with — see directPeerIds, which derives that from vx_convs.
 *
 * Ordering: authors with something unseen first, then whoever posted most recently, with an
 * author's own items oldest-first so the viewer plays them in the order they were posted.
 */
export async function listStatusFeed(viewerId: string): Promise<StatusAuthor[]> {
  const rows = await q<StatusRow>(
    `select ${STATUS_COLUMNS}
       from vx_status s
      where s.expires_at > $1
      order by s.created_at asc`,
    [Date.now(), viewerId]
  );

  const grouped = new Map<string, Status[]>();
  for (const row of rows) {
    const item = toStatus(row);
    const list = grouped.get(row.user_id);
    if (list) list.push(item);
    else grouped.set(row.user_id, [item]);
  }

  const authors: StatusAuthor[] = [];
  for (const [authorId, items] of grouped) {
    const isSelf = authorId === viewerId;
    const settings = await getSettings(authorId);
    if (!isSelf && settings.privacy.statusPrivacy === 'chats') {
      const peers = await directPeerIds(authorId);
      if (!peers.includes(viewerId)) continue;
    }
    const author = await getUser(authorId);
    if (!author) continue;
    authors.push({
      user: {
        ...toPublicUser(author),
        // The same projection presentMember applies elsewhere: a photo hidden from everyone
        // else is hidden on the updates screen too.
        avatar:
          isSelf || settings.privacy.profilePhoto !== 'nobody' ? author.avatar : null,
      },
      // Only an author may know who watched, so everyone else's count is blanked here.
      items: isSelf ? items : items.map((item) => ({ ...item, viewCount: 0 })),
    });
  }

  const lastAt = (author: StatusAuthor) => author.items[author.items.length - 1]?.createdAt ?? 0;
  authors.sort((a, b) => {
    const unseen = Number(isUnseen(b)) - Number(isUnseen(a));
    return unseen !== 0 ? unseen : lastAt(b) - lastAt(a);
  });
  return authors;
}

/**
 * Record that a viewer opened one update.
 *
 * Idempotent by primary key, so re-opening an item writes nothing the second time — which is
 * what the viewer relies on when it walks back and forth through an author's items.
 */
export async function markStatusSeen(statusId: string, viewerId: string): Promise<void> {
  await q(
    `insert into vx_status_views (status_id, viewer_id, viewed_at)
     values ($1, $2, $3)
     on conflict (status_id, viewer_id) do nothing`,
    [statusId, viewerId, Date.now()]
  );
}

/**
 * Who watched one of your own updates, most recent first.
 *
 * The join to vx_status enforces ownership in the query itself rather than trusting the
 * caller, so a non-author cannot read the list even if a route ever forgot to check.
 */
export async function listStatusViewers(
  statusId: string,
  ownerId: string
): Promise<StatusViewer[]> {
  const rows = await q<{ viewer_id: string; viewed_at: number }>(
    `select v.viewer_id, v.viewed_at
       from vx_status_views v
       join vx_status s on s.id = v.status_id
      where v.status_id = $1 and s.user_id = $2
      order by v.viewed_at desc`,
    [statusId, ownerId]
  );

  const viewers: StatusViewer[] = [];
  for (const row of rows) {
    if (row.viewer_id === ownerId) continue;
    const user = await getUser(row.viewer_id);
    if (!user) continue;
    const settings = await getSettings(row.viewer_id);
    viewers.push({
      user: {
        ...toPublicUser(user),
        avatar: settings.privacy.profilePhoto !== 'nobody' ? user.avatar : null,
      },
      viewedAt: Number(row.viewed_at),
    });
  }
  return viewers;
}

/** Delete one of your own updates, along with the rows recording who watched it. */
export async function deleteStatus(statusId: string, userId: string): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `delete from vx_status where id = $1 and user_id = $2 returning id`,
    [statusId, userId]
  );
  if (!rows.length) return false;
  await q(`delete from vx_status_views where status_id = $1`, [statusId]);
  return true;
}

/* ── channels (broadcast) ──────────────────────────────────────────────── */

type ChannelRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  created_at: number;
  following: boolean;
  followers: number;
  unread: number;
  last_id: string | null;
  last_kind: string | null;
  last_text: string | null;
  last_media_url: string | null;
  last_created_at: number | null;
};

function toChannelPost(r: {
  id: string;
  channel_id: string;
  author_id: string;
  kind: string;
  text: string | null;
  media_url: string | null;
  created_at: number;
}): ChannelPost {
  return {
    id: r.id,
    channelId: r.channel_id,
    authorId: r.author_id,
    kind: r.kind === 'image' ? 'image' : 'text',
    text: r.text ?? null,
    mediaUrl: r.media_url ?? null,
    createdAt: Number(r.created_at),
  };
}

function toChannel(r: ChannelRow, viewerId: string): Channel {
  const lastPost: ChannelPost | null = r.last_id
    ? {
        id: r.last_id,
        channelId: r.id,
        authorId: r.owner_id,
        kind: r.last_kind === 'image' ? 'image' : 'text',
        text: r.last_text ?? null,
        mediaUrl: r.last_media_url ?? null,
        createdAt: Number(r.last_created_at ?? 0),
      }
    : null;
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    description: r.description ?? null,
    avatar: r.avatar ?? null,
    createdAt: Number(r.created_at),
    isOwner: r.owner_id === viewerId,
    // An owner counts as following their own channel: they were made its first follower.
    following: Boolean(r.following),
    followers: Number(r.followers ?? 0),
    unread: Number(r.unread ?? 0),
    lastPostAt: r.last_created_at === null ? null : Number(r.last_created_at),
    lastPost,
  };
}

/**
 * The one read every channel list and the channel header share.
 *
 * The three per-viewer numbers are folded into the query rather than fetched per row, so a
 * list of fifty channels is still one statement:
 *  - `following` — the owner always is, everyone else only with a vx_channel_follows row;
 *  - `followers` — the audience size the header shows;
 *  - `unread` — posts newer than the viewer's own read mark.
 *
 * The newest post rides along from a lateral join, which is what lets a list row show a
 * preview without a request per channel. The viewer placeholder is passed in because a query
 * numbering its parameters differently still has to be able to use this — the same reason
 * STATUS_COLUMNS hard-codes $2 and requires the caller to match.
 */
function channelQuery(viewer: string): string {
  return `select
    c.*,
    (c.owner_id = ${viewer} or exists (
      select 1 from vx_channel_follows f
       where f.channel_id = c.id and f.user_id = ${viewer}
    )) as following,
    (select count(*) from vx_channel_follows f where f.channel_id = c.id) as followers,
    (select count(*) from vx_channel_posts p
      where p.channel_id = c.id
        and p.created_at > coalesce((
          select f.last_read_at from vx_channel_follows f
           where f.channel_id = c.id and f.user_id = ${viewer}
        ), 0)) as unread,
    newest.id as last_id,
    newest.kind as last_kind,
    newest.text as last_text,
    newest.media_url as last_media_url,
    newest.created_at as last_created_at
  from vx_channels c
  left join lateral (
    select p.id, p.kind, p.text, p.media_url, p.created_at
      from vx_channel_posts p
     where p.channel_id = c.id
     order by p.created_at desc
     limit 1
  ) newest on true`;
}

/**
 * Create a broadcast. The creator is its first follower, so a channel they own behaves
 * exactly like one they follow everywhere else.
 */
export async function createChannel(
  ownerId: string,
  input: { name: string; description?: string | null; avatar?: string | null }
): Promise<Channel> {
  const now = Date.now();
  const id = newId('ch');
  const channel: Channel = {
    id,
    ownerId,
    name: input.name,
    description: input.description ?? null,
    avatar: input.avatar ?? null,
    createdAt: now,
    isOwner: true,
    following: true,
    followers: 1,
    unread: 0,
    lastPostAt: null,
    lastPost: null,
  };
  await q(
    `insert into vx_channels (id, owner_id, name, description, avatar, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, ownerId, channel.name, channel.description, channel.avatar, now]
  );
  // Read mark equal to now: an empty channel starts with nothing unseen, and the owner's own
  // posts are stamped forward in createChannelPost.
  await q(
    `insert into vx_channel_follows (channel_id, user_id, followed_at, last_read_at)
     values ($1, $2, $3, $3)
     on conflict (channel_id, user_id) do nothing`,
    [id, ownerId, now]
  );
  return channel;
}

/**
 * The channels the viewer follows, most recently active first, with the ones they own in the
 * same list — an owner follows their own channel, so no special case is needed.
 */
export async function listMyChannels(userId: string): Promise<Channel[]> {
  const rows = await q<ChannelRow>(
    `${channelQuery('$1')}
      where exists (
        select 1 from vx_channel_follows f
         where f.channel_id = c.id and f.user_id = $1
      )
      order by coalesce(newest.created_at, c.created_at) desc
      limit 100`,
    [userId]
  );
  return rows.map((row) => toChannel(row, userId));
}

/**
 * Channels the viewer does not follow yet, most followed first.
 *
 * No visibility rule beyond the follow: unlike a status, a channel is a public broadcast by
 * nature, and a list nobody may appear in would be a list nobody could ever join.
 */
export async function listDiscoverableChannels(userId: string): Promise<Channel[]> {
  const rows = await q<ChannelRow>(
    `${channelQuery('$1')}
      where c.owner_id <> $1
        and not exists (
          select 1 from vx_channel_follows f
           where f.channel_id = c.id and f.user_id = $1
        )
      order by followers desc, c.created_at desc
      limit 50`,
    [userId]
  );
  return rows.map((row) => toChannel(row, userId));
}

/**
 * One channel, provided the viewer may read it: a follower, or the owner whether or not a
 * follow row exists.
 *
 * Null for both "no such channel" and "not yours to read" — the route turns either into the
 * same 404, so a stranger cannot learn which channel ids exist by asking for them.
 */
export async function getChannel(channelId: string, userId: string): Promise<Channel | null> {
  if (!channelId) return null;
  const rows = await q<ChannelRow>(
    `${channelQuery('$2')}
      where c.id = $1
        and (c.owner_id = $2 or exists (
          select 1 from vx_channel_follows f
           where f.channel_id = c.id and f.user_id = $2
        ))
      limit 1`,
    [channelId, userId]
  );
  return rows[0] ? toChannel(rows[0], userId) : null;
}

/**
 * Follow a channel.
 *
 * Idempotent: a double tap writes nothing the second time, so the audience cannot be
 * double-counted. `last_read_at` starts at now rather than 0, because joining a broadcast
 * means the posts already there are not "unseen" — only what arrives afterwards is.
 */
export async function followChannel(channelId: string, userId: string): Promise<void> {
  const now = Date.now();
  const found = await q<{ id: string }>(`select id from vx_channels where id = $1`, [channelId]);
  if (!found.length) throw new Error('Channel not found');
  await q(
    `insert into vx_channel_follows (channel_id, user_id, followed_at, last_read_at)
     values ($1, $2, $3, $3)
     on conflict (channel_id, user_id) do nothing`,
    [channelId, userId, now]
  );
}

/**
 * Leave a channel. An owner cannot leave their own — there would then be nobody able to post
 * and no way back in, so it is refused rather than silently ignored.
 */
export async function unfollowChannel(channelId: string, userId: string): Promise<boolean> {
  const rows = await q<{ owner_id: string }>(
    `select owner_id from vx_channels where id = $1`,
    [channelId]
  );
  const channel = rows[0];
  if (!channel) throw new Error('Channel not found');
  if (channel.owner_id === userId) {
    throw new Error('Forbidden: an owner cannot leave their own channel');
  }
  const removed = await q<{ channel_id: string }>(
    `delete from vx_channel_follows
      where channel_id = $1 and user_id = $2
      returning channel_id`,
    [channelId, userId]
  );
  return removed.length > 0;
}

/**
 * The posts of one channel, oldest first, limited to the newest `limit` of them.
 *
 * The visibility rule is repeated here rather than trusted from the caller, so a route that
 * ever forgot to check would return posts belonging to a stranger's broadcast. An empty list
 * is a channel with nothing in it; a viewer who may not read gets the same empty list, and
 * every route reaches this only after getChannel has already refused them.
 */
export async function listChannelPosts(
  channelId: string,
  viewerId: string,
  limit = 100
): Promise<ChannelPost[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  const rows = await q<{
    id: string;
    channel_id: string;
    author_id: string;
    kind: string;
    text: string | null;
    media_url: string | null;
    created_at: number;
  }>(
    `select * from (
       select p.id, p.channel_id, p.author_id, p.kind, p.text, p.media_url, p.created_at
         from vx_channel_posts p
         join vx_channels c on c.id = p.channel_id
        where p.channel_id = $1
          and (c.owner_id = $2 or exists (
            select 1 from vx_channel_follows f
             where f.channel_id = c.id and f.user_id = $2
          ))
        order by p.created_at desc
        limit $3
     ) newest
     order by newest.created_at asc`,
    [channelId, viewerId, capped]
  );
  return rows.map(toChannelPost);
}

/**
 * Post to a channel.
 *
 * Ownership is enforced in the statement itself, not only before it: the insert selects its
 * one row from vx_channels with the owner in the where clause, so a caller who is not the
 * owner writes nothing and no row comes back — the check and the write cannot disagree.
 */
export async function createChannelPost(
  channelId: string,
  authorId: string,
  input: { kind: ChannelPost['kind']; text?: string | null; mediaUrl?: string | null }
): Promise<ChannelPost> {
  const now = Date.now();
  const post: ChannelPost = {
    id: newId('cp'),
    channelId,
    authorId,
    kind: input.kind,
    text: input.text ?? null,
    mediaUrl: input.mediaUrl ?? null,
    createdAt: now,
  };
  const rows = await q<{ id: string }>(
    `insert into vx_channel_posts (id, channel_id, author_id, kind, text, media_url, created_at)
     select $2, c.id, $3, $4, $5, $6, $7
       from vx_channels c
      where c.id = $1 and c.owner_id = $3
     returning id`,
    [channelId, post.id, authorId, post.kind, post.text, post.mediaUrl, now]
  );
  if (!rows.length) throw new Error('Forbidden: only the channel owner can post');

  // Your own post is never unread to you: move your own read mark forward with it.
  await q(
    `update vx_channel_follows set last_read_at = $3
      where channel_id = $1 and user_id = $2 and last_read_at < $3`,
    [channelId, authorId, now]
  );
  return post;
}

/**
 * Move the viewer's read mark to now, which is what clears the unread dot on the list.
 *
 * A no-op for anyone without a follow row — including the owner of a channel whose own post
 * never left anything unread in the first place.
 */
export async function markChannelRead(channelId: string, userId: string): Promise<void> {
  const now = Date.now();
  await q(
    `update vx_channel_follows set last_read_at = $3
      where channel_id = $1 and user_id = $2 and last_read_at < $3`,
    [channelId, userId, now]
  );
}

/**
 * Who follows one of your channels, most recent first.
 *
 * The join to vx_channels enforces ownership in the query itself rather than trusting the
 * caller, so a non-owner reads nothing even if a route ever forgot to check — the same
 * arrangement as listStatusViewers.
 */
export async function getChannelFollowers(
  channelId: string,
  ownerId: string
): Promise<ChannelFollower[]> {
  const rows = await q<{ user_id: string; followed_at: number }>(
    `select f.user_id, f.followed_at
       from vx_channel_follows f
       join vx_channels c on c.id = f.channel_id
      where f.channel_id = $1 and c.owner_id = $2
      order by f.followed_at desc`,
    [channelId, ownerId]
  );

  const followers: ChannelFollower[] = [];
  for (const row of rows) {
    const user = await getUser(row.user_id);
    if (!user) continue;
    const settings = await getSettings(row.user_id);
    followers.push({
      user: {
        ...toPublicUser(user),
        // The same projection the updates screen applies: a photo hidden from everyone else
        // is hidden in a follower list too.
        avatar: settings.privacy.profilePhoto !== 'nobody' ? user.avatar : null,
      },
      followedAt: Number(row.followed_at),
    });
  }
  return followers;
}

/* ── calls (voice and video) ───────────────────────────────────────────── */

/**
 * How long a call rings before it counts as missed.
 *
 * Nothing sweeps the table when this elapses. Like an expired status, an unanswered call is a
 * filter applied when it is read, so the window costs no background work and a row that was
 * never answered cannot outlive it — or block the next call, which it would if 'ringing' alone
 * meant live.
 */
export const CALL_RING_MS = 45_000;

/**
 * An SDP body is a few kilobytes. Anything far larger is not one, and is not worth storing.
 *
 * Exported so the route can reject an oversized payload *before* calling in here. The check
 * below still stands as a second line of defence, but a throw from here reaches the caller as a
 * 500 — a validation failure wearing a server-error costume, which reads like a broken deploy
 * rather than a bad request.
 */
export const MAX_SIGNAL_PAYLOAD = 20_000;

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  kind: string;
  status: string;
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
  ended_by: string | null;
};

const CALL_COLUMNS = `c.id, c.caller_id, c.callee_id, c.kind, c.status,
  c.created_at, c.answered_at, c.ended_at, c.ended_by`;

/**
 * A row's status as it should be read *now*: a ringing call that has been ringing for longer
 * than the window is a missed call, whether or not anybody has written that down.
 */
function callStatus(status: string, createdAt: number, now: number): Call['status'] {
  if (status === 'ringing') return createdAt <= now - CALL_RING_MS ? 'missed' : 'ringing';
  if (status === 'accepted') return 'accepted';
  if (status === 'declined') return 'declined';
  if (status === 'missed') return 'missed';
  return 'ended';
}

/**
 * Row to wire shape. The peer is the other party, so neither call screen has to decide which
 * end it is on, and the derived fields are computed here rather than stored.
 *
 * Null when the other account is gone: a call to a user who no longer exists has no name or
 * picture to draw, and both callers (the live read and the history list) simply drop it.
 */
async function toCall(r: CallRow, viewerId: string, now: number): Promise<Call | null> {
  const peerId = r.caller_id === viewerId ? r.callee_id : r.caller_id;
  const peer = await getUser(peerId);
  if (!peer) return null;
  const settings = await getSettings(peerId);
  const status = callStatus(r.status, Number(r.created_at), now);
  const answeredAt = r.answered_at === null ? null : Number(r.answered_at);
  const endedAt = r.ended_at === null ? null : Number(r.ended_at);
  return {
    id: r.id,
    callerId: r.caller_id,
    calleeId: r.callee_id,
    kind: r.kind === 'video' ? 'video' : 'audio',
    status,
    createdAt: Number(r.created_at),
    answeredAt,
    endedAt,
    endedBy: r.ended_by ?? null,
    peer: {
      ...toPublicUser(peer),
      // The same projection the updates screen and the follower list apply.
      avatar: settings.privacy.profilePhoto !== 'nobody' ? peer.avatar : null,
    },
    direction: r.caller_id === viewerId ? 'outgoing' : 'incoming',
    missed: status === 'missed',
    // A call that was never answered has no duration, which is also what tells the list to
    // print one at all.
    durationMs: answeredAt === null ? null : Math.max(0, (endedAt ?? now) - answeredAt),
  };
}

/**
 * What went wrong when a write touched no row, said properly.
 *
 * The updates all carry their own authorisation in the WHERE clause, so "no rows" covers four
 * different situations: no such call, somebody else's call, a call that has already finished,
 * and a call that has already been answered. Only the row itself can tell them apart, and a
 * caller that is told the wrong one wastes their time.
 */
async function callRefusal(callId: string, userId: string, action: string): Promise<Error> {
  const rows = await q<{ caller_id: string; callee_id: string; status: string; created_at: number }>(
    `select caller_id, callee_id, status, created_at from vx_calls where id = $1`,
    [callId]
  );
  const row = rows[0];
  if (!row) return new Error('Call not found');
  if (row.caller_id !== userId && row.callee_id !== userId) {
    return new Error('Forbidden: that call is not yours');
  }
  if (row.status === 'ringing' && Number(row.created_at) <= Date.now() - CALL_RING_MS) {
    return new Error('Forbidden: this call is no longer ringing');
  }
  if (row.status === 'accepted') return new Error('Forbidden: this call is already answered');
  if (row.status !== 'ringing') return new Error('Forbidden: this call has already finished');
  return new Error(`Forbidden: only the receiver can ${action} a call`);
}

/**
 * One call by id, provided the reader is one of its two participants.
 *
 * Exported for the signals route: `listCallSignals` filters by participant inside its join, so a
 * stranger there would otherwise receive an empty list with a 200 — indistinguishable from "the
 * other side has not sent anything yet", which is a confusing thing to debug at 1 a.m.
 */
export async function callFor(callId: string, userId: string): Promise<Call | null> {
  if (!callId) return null;
  const rows = await q<CallRow>(
    `select ${CALL_COLUMNS} from vx_calls c
      where c.id = $1 and (c.caller_id = $2 or c.callee_id = $2)
      limit 1`,
    [callId, userId]
  );
  return rows[0] ? toCall(rows[0], userId, Date.now()) : null;
}

/**
 * Start a call.
 *
 * Three refusals, and all three are enforced by the insert rather than before it: the statement
 * selects its row from vx_users, so a missing callee inserts nothing, and the `not exists` on
 * vx_calls means a caller or a callee who is already in a live call inserts nothing either.
 * Only afterwards, to say *which* refusal it was, does it look anything up.
 *
 * A live call here means accepted, or ringing inside its window — the same rule getLiveCall
 * reads by, so a call that has aged out cannot keep either party busy forever.
 */
export async function startCall(
  callerId: string,
  calleeId: string,
  kind: Call['kind']
): Promise<Call> {
  if (kind !== 'audio' && kind !== 'video') throw new Error('A call must be audio or video');
  const now = Date.now();
  const id = newId('call');
  const rows = await q<{ id: string }>(
    `insert into vx_calls (id, caller_id, callee_id, kind, status, created_at)
     select $1, $2, u.id, $3, 'ringing', $4
       from vx_users u
      where u.id = $5
        and u.id <> $2
        and not exists (
          select 1 from vx_calls c
           where (c.caller_id = $2 or c.callee_id = $2
                  or c.caller_id = $5 or c.callee_id = $5)
             and (c.status = 'accepted'
                  or (c.status = 'ringing' and c.created_at > $6))
        )
     returning id`,
    [id, callerId, kind, now, calleeId, now - CALL_RING_MS]
  );

  if (!rows.length) {
    if (callerId === calleeId) throw new Error('Forbidden: you cannot call yourself');
    const peer = await q<{ id: string }>(`select id from vx_users where id = $1`, [calleeId]);
    if (!peer.length) throw new Error('That person was not found');
    const mine = await q<{ id: string }>(
      `select c.id from vx_calls c
        where (c.caller_id = $1 or c.callee_id = $1)
          and (c.status = 'accepted' or (c.status = 'ringing' and c.created_at > $2))
        limit 1`,
      [callerId, now - CALL_RING_MS]
    );
    throw new Error(
      mine.length
        ? 'Forbidden: you are already on a call'
        : 'Forbidden: that person is already on a call'
    );
  }

  const call = await callFor(id, callerId);
  if (!call) throw new Error('Call not found');
  return call;
}

/**
 * The user's live call, or null.
 *
 * Cheap on purpose: it is polled about once a second while a call is up and every few seconds
 * the rest of the time, because it is what draws the incoming-call surface. A ringing call is
 * only live inside its 45 second window — the filter is in the WHERE clause, so an unanswered
 * call ages out of this query on its own.
 */
export async function getLiveCall(userId: string): Promise<Call | null> {
  const now = Date.now();
  const rows = await q<CallRow>(
    `select ${CALL_COLUMNS} from vx_calls c
      where (c.caller_id = $1 or c.callee_id = $1)
        and (c.status = 'accepted'
             or (c.status = 'ringing' and c.created_at > $2))
      order by c.created_at desc
      limit 1`,
    [userId, now - CALL_RING_MS]
  );
  return rows[0] ? toCall(rows[0], userId, now) : null;
}

/**
 * Recent calls either way, newest first, each already resolved from this user's side.
 *
 * The peer of a row costs a user and a settings lookup, both cached for a few seconds, so a
 * list where the same handful of people appear over and over is a handful of queries rather
 * than one per row.
 */
export async function listCallHistory(userId: string, limit = 50): Promise<Call[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  const now = Date.now();
  const rows = await q<CallRow>(
    `select ${CALL_COLUMNS} from vx_calls c
      where c.caller_id = $1 or c.callee_id = $1
      order by c.created_at desc
      limit $2`,
    [userId, capped]
  );
  const calls: Call[] = [];
  for (const row of rows) {
    const call = await toCall(row, userId, now);
    if (call) calls.push(call);
  }
  return calls;
}

/**
 * Pick up a call: the callee, while it is still ringing and still inside the window.
 *
 * The three conditions are the statement's own WHERE clause rather than a read followed by a
 * write, so two taps cannot both believe they were the one that answered — the second updates
 * nothing and is told the call is no longer ringing.
 */
export async function acceptCall(callId: string, userId: string): Promise<Call> {
  const now = Date.now();
  const rows = await q<{ id: string }>(
    `update vx_calls
        set status = 'accepted', answered_at = $3
      where id = $1 and callee_id = $2 and status = 'ringing' and created_at > $4
      returning id`,
    [callId, userId, now, now - CALL_RING_MS]
  );
  if (!rows.length) throw await callRefusal(callId, userId, 'accept');
  const call = await callFor(callId, userId);
  if (!call) throw new Error('Call not found');
  return call;
}

/** Refuse a call: the callee, while it is still ringing. */
export async function declineCall(callId: string, userId: string): Promise<Call> {
  const now = Date.now();
  const rows = await q<{ id: string }>(
    `update vx_calls
        set status = 'declined', ended_at = $3, ended_by = $2
      where id = $1 and callee_id = $2 and status = 'ringing'
      returning id`,
    [callId, userId, now]
  );
  if (!rows.length) throw await callRefusal(callId, userId, 'decline');
  const call = await callFor(callId, userId);
  if (!call) throw new Error('Call not found');
  return call;
}

/**
 * Hang up: either participant, while the call is ringing or up.
 *
 * A ringing call that the *caller* gives up on becomes 'missed' rather than 'ended' — nobody
 * was there to answer it. A call that was picked up is simply 'ended'.
 */
export async function endCall(callId: string, userId: string): Promise<Call> {
  const now = Date.now();
  const rows = await q<{ id: string }>(
    `update vx_calls
        set status = case
              when status = 'ringing' and caller_id = $2 then 'missed'
              else 'ended'
            end,
            ended_at = $3,
            ended_by = $2
      where id = $1
        and (caller_id = $2 or callee_id = $2)
        and status in ('ringing', 'accepted')
      returning id`,
    [callId, userId, now]
  );
  if (!rows.length) throw await callRefusal(callId, userId, 'end');
  const call = await callFor(callId, userId);
  if (!call) throw new Error('Call not found');
  return call;
}

/**
 * Post one signal — an offer, an answer or an ICE candidate.
 *
 * The participants rule is the insert's own `select ... from vx_calls where ...`, so a
 * non-participant writes nothing rather than being trusted not to. The status check is there
 * too: signals for a call that is over are not stored, which keeps the table from growing one
 * dead conversation per abandoned call.
 */
export async function addCallSignal(
  callId: string,
  fromId: string,
  kind: CallSignal['kind'],
  payload: string
): Promise<void> {
  if (kind !== 'offer' && kind !== 'answer' && kind !== 'candidate') {
    throw new Error('That is not a call signal');
  }
  const body = String(payload ?? '');
  if (!body) throw new Error('An empty call signal cannot be sent');
  if (body.length > MAX_SIGNAL_PAYLOAD) throw new Error('That call signal is too large');

  const rows = await q<{ seq: number }>(
    `insert into vx_call_signals (call_id, from_id, kind, payload, created_at)
     select $1, $2, $3, $4, $5
       from vx_calls c
      where c.id = $1
        and (c.caller_id = $2 or c.callee_id = $2)
        and c.status in ('ringing', 'accepted')
     returning seq`,
    [callId, fromId, kind, body, Date.now()]
  );
  if (!rows.length) throw new Error('Forbidden: that call is not yours');
}

/**
 * Everything the other side has said since `afterSeq`, oldest first.
 *
 * A cursor rather than a "since" timestamp, because two signals can be written in the same
 * millisecond and a timestamp would then either repeat one or skip one. The visibility rule
 * is repeated in the join, the same way listChannelPosts repeats it.
 */
export async function listCallSignals(
  callId: string,
  userId: string,
  afterSeq = 0
): Promise<CallSignal[]> {
  const after = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const rows = await q<{ seq: number; from_id: string; kind: string; payload: string }>(
    `select s.seq, s.from_id, s.kind, s.payload
       from vx_call_signals s
       join vx_calls c on c.id = s.call_id
      where s.call_id = $1
        and (c.caller_id = $2 or c.callee_id = $2)
        and s.seq > $3
      order by s.seq asc
      limit 250`,
    [callId, userId, after]
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    kind:
      row.kind === 'offer' ? 'offer' : row.kind === 'answer' ? 'answer' : 'candidate',
    fromId: row.from_id,
    payload: row.payload,
  }));
}

/* ── whatsapp pairing (an external bot links the number) ───────────────── */

/**
 * How long a pairing request stays claimable.
 *
 * Five minutes, and no longer: the bot's own watchdog fails a request that has not produced a
 * code within ninety seconds, so a longer window here would leave the screen waiting on an
 * answer that can no longer arrive.
 */
export const WHATSAPP_PAIRING_TTL_MS = 5 * 60_000;

/**
 * Returned when one account already has a request the bot has not finished with.
 *
 * Exported so the route can tell this refusal — which is the caller's fault — from a database
 * error, and answer it with a conflict rather than the 500 a bare throw would become.
 */
export const PAIRING_BUSY = 'You already have a WhatsApp pairing request in progress';

/**
 * Canonicalise a number for the pairing bot: a leading "+", then 8 to 15 digits.
 *
 * Deliberately not normalisePhone(): that one accepts seven digits and rewrites a leading
 * zero, which is right for a Varnox login identifier but wrong here, because the string is
 * handed to WhatsApp and must be the international form as the user wrote it. Spaces, dashes
 * and brackets are the only things dropped.
 */
export function pairingPhone(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  const compact = raw.replace(/[\s()\[\].-]/g, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * A timestamptz column as epoch milliseconds.
 *
 * node-postgres hands a timestamptz back as a Date, but a driver change or a hand-written
 * string would hand back something else, and a screen showing "Invalid Date" is worse than
 * one showing nothing. Anything unreadable reads as 0.
 */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value == null) return 0;
  const at = new Date(String(value)).getTime();
  return Number.isFinite(at) ? at : 0;
}

type PairingRow = {
  id: number;
  user_id: string;
  phone: string;
  status: string;
  pairing_code: string | null;
  error: string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

function toPairing(r: PairingRow): WhatsAppPairing {
  return {
    id: Number(r.id),
    phone: r.phone,
    status: r.status,
    code: r.pairing_code ?? null,
    error: r.error ?? null,
    expiresAt: toEpochMs(r.expires_at),
    createdAt: toEpochMs(r.created_at),
  };
}

/**
 * Queue a pairing request for the external bot to pick up.
 *
 * One request per account at a time: while a pending or processing row still has time on it,
 * a second request is refused, so a double tap cannot queue two and the screen only ever has
 * one thing to watch. The expired-but-unswept case is excluded on purpose — the bot's own
 * claim ignores an expired row, so refusing here would otherwise lock the account out until
 * its watchdog ran.
 */
export async function startWhatsAppPairing(
  userId: string,
  phone: string
): Promise<WhatsAppPairing> {
  const normalised = pairingPhone(phone);
  if (!normalised) {
    throw new Error('That does not look like an international phone number');
  }

  const existing = await q<{ id: number }>(
    `select id from varnox_pairing_requests
      where user_id = $1 and status in ('pending', 'processing') and expires_at > now()
      limit 1`,
    [userId]
  );
  if (existing.length) throw new Error(PAIRING_BUSY);

  const now = Date.now();
  const rows = await q<PairingRow>(
    `insert into varnox_pairing_requests
       (user_id, phone, status, expires_at, created_at, updated_at)
     values ($1, $2, 'pending', $3, $4, $4)
     returning *`,
    [userId, normalised, new Date(now + WHATSAPP_PAIRING_TTL_MS), new Date(now)]
  );
  const row = rows[0];
  if (!row) throw new Error('Could not start the pairing request');
  return toPairing(row);
}

/**
 * One request, and only for the user who made it.
 *
 * Scoped by user_id in the query itself rather than checked afterwards, so a stranger asking
 * for an id they guessed reads nothing — and never somebody else's pairing code. Null covers
 * both "no such request" and "not yours", so the two are indistinguishable to the caller.
 */
export async function getWhatsAppPairing(
  id: number,
  userId: string
): Promise<WhatsAppPairing | null> {
  if (!Number.isFinite(id)) return null;
  const rows = await q<PairingRow>(
    'select * from varnox_pairing_requests where id = $1 and user_id = $2',
    [id, userId]
  );
  return rows[0] ? toPairing(rows[0]) : null;
}

type WhatsAppSessionRow = {
  id: string;
  phone: string | null;
  status: string | null;
  updated_at: Date | string;
};

/**
 * The WhatsApp numbers this account has linked, newest first.
 *
 * A session is attributed to a user through the pairing request that created it: the bot's
 * session id is 'web_' followed by the phone number, and the same phone appears in
 * varnox_pairing_requests with the user_id that asked for it. A phone only counts once a
 * pairing for it has actually reached 'connected', so a session row the bot wrote for a
 * failed attempt never appears. A session the bot has marked 'disconnected' is filtered out
 * of the list rather than deleted — the row stays as history.
 */
export async function listWhatsAppSessions(userId: string): Promise<WhatsAppSession[]> {
  const rows = await q<WhatsAppSessionRow>(
    `select s.id, s.phone, s.status, s.updated_at
       from varnox_sessions s
      where s.status is distinct from 'disconnected'
        and exists (
          select 1 from varnox_pairing_requests p
           where p.user_id = $1
             and 'web_' || p.phone = s.id
             and p.status = 'connected'
        )
      order by s.updated_at desc`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    phone: r.phone ?? '',
    status: r.status ?? '',
    updatedAt: toEpochMs(r.updated_at),
  }));
}

/**
 * Drop a linked number from this account's list.
 *
 * The delete is scoped to a session whose phone this user actually paired, so an id belonging
 * to somebody else deletes nothing. Nothing is revoked at WhatsApp: this removes the app's
 * list entry, and the phone is not handed back to the bot — it stays linked on that side.
 */
export async function forgetWhatsAppSession(
  userId: string,
  sessionId: string
): Promise<boolean> {
  if (!sessionId) return false;
  const rows = await q<{ id: string }>(
    `delete from varnox_sessions s
      where s.id = $1
        and exists (
          select 1 from varnox_pairing_requests p
           where p.user_id = $2
             and 'web_' || p.phone = s.id
             and p.status = 'connected'
        )
      returning s.id`,
    [sessionId, userId]
  );
  return rows.length > 0;
}
