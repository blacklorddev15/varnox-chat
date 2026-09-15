import { cached, invalidate } from './cache';
import { rand } from './ids';
import { q } from './pg';
import { looksLikePhone, phoneKey } from './phone';
import type {
  ChatPrefs,
  Conv,
  ConvType,
  Invite,
  MemberMarker,
  Message,
  MsgOp,
  PublicUser,
  Reaction,
  StarredItem,
  User,
  UserSettings,
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
    displayName: r.display_name,
    about: r.about ?? '',
    avatar: r.avatar ?? null,
    pwHash: r.pw_hash,
    createdAt: Number(r.created_at),
    lastSeen: Number(r.last_seen),
  };
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    phone: u.phone ?? null,
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
       (id, username, phone, display_name, about, avatar, pw_hash, created_at, last_seen)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       username = excluded.username,
       phone = excluded.phone,
       display_name = excluded.display_name,
       about = excluded.about,
       avatar = excluded.avatar,
       pw_hash = excluded.pw_hash,
       last_seen = excluded.last_seen`,
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
    ]
  );
  invalidate(`u:${user.id}`);
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

/** Find people by username prefix, or by an exact phone number. */
export async function searchUsers(term: string, excludeId: string): Promise<PublicUser[]> {
  const raw = term.trim();
  if (raw.length < 1) return [];

  const ids = new Set<string>();

  // Escape LIKE wildcards so a search for "a_b" cannot match "axb".
  const prefix = raw.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const byName = await q<{ user_id: string }>(
    'select user_id from vx_usernames where username like $1 order by username limit 12',
    [prefix]
  );
  for (const r of byName) ids.add(r.user_id);

  if (looksLikePhone(raw)) {
    const byPhone = await getUserByPhone(raw);
    if (byPhone) ids.add(byPhone.id);
  }

  ids.delete(excludeId);
  const users = await Promise.all([...ids].slice(0, 12).map((id) => getUser(id)));
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
  await q(
    `insert into vx_phones (phone, user_id) values ($1, $2)
     on conflict (phone) do update set user_id = excluded.user_id`,
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
  if (r.reply_to != null) msg.replyTo = r.reply_to;
  return msg;
}

export async function saveMessage(msg: Message): Promise<void> {
  await q(
    `insert into vx_messages
       (id, conv_id, sender_id, sender_name, at, type, text, media_url, media_w, media_h,
        audio_sec, file_name, file_size, mime, forwarded, reply_to)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
       reply_to = excluded.reply_to`,
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
    ]
  );
  invalidate(`m:${msg.convId}`);
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
    privacy: { lastSeen: 'everyone', profilePhoto: 'everyone', readReceipts: true },
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
