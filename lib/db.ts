import {
  ROOT,
  cached,
  invalidate,
  listAll,
  listPrefix,
  newestJson,
  putJson,
  rand,
  readJson,
  sortNewest,
  versionKey,
} from './blob';
import type {
  ChatPrefs,
  Conv,
  ConvRead,
  ConvType,
  Invite,
  MemberMarker,
  Message,
  MsgOp,
  Presence,
  PublicUser,
  Reaction,
  ReadState,
  StarredItem,
  TypingState,
  User,
  UserSettings,
} from './types';

const usersPrefix = (id: string) => `${ROOT}/u/${id}`;
const nameIndexPrefix = (usernameLower: string) => `${ROOT}/n/${usernameLower}`;
const convPrefix = (id: string) => `${ROOT}/c/${id}`;
const memberPrefix = (userId: string) => `${ROOT}/uc/${userId}`;
const msgPrefix = (convId: string) => `${ROOT}/m/${convId}`;
const opPrefix = (convId: string) => `${ROOT}/mo/${convId}`;
const readMapPrefix = (userId: string) => `${ROOT}/ur/${userId}`;
const convReadPrefix = (convId: string) => `${ROOT}/r/${convId}`;
const settingsPrefix = (userId: string) => `${ROOT}/set/${userId}`;
const reactionPrefix = (convId: string) => `${ROOT}/rx/${convId}`;
const starPrefix = (userId: string) => `${ROOT}/star/${userId}`;
const typingPrefix = (convId: string) => `${ROOT}/ty/${convId}`;
const presencePrefix = (userId: string) => `${ROOT}/pr/${userId}`;
const invitePrefix = (code: string) => `${ROOT}/inv/${code}`;

export function inverseStamp(at: number): string {
  return String(9_999_999_999_999 - at).padStart(13, '0');
}

/** pathname segment helpers ------------------------------------------------ */

function segs(pathname: string): string[] {
  return pathname.split('/');
}

// vx/m/<convId>/<inv>-<senderId>-<msgId>.json
function parseMsgPath(pathname: string) {
  const s = segs(pathname);
  const file = s[s.length - 1] ?? '';
  const convId = s[s.length - 2] ?? '';
  const base = file.replace(/\.json$/, '');
  const [inv, senderId, msgId] = base.split('-');
  return { convId, inv, senderId, msgId };
}

/** users ------------------------------------------------------------------- */

export async function getUser(id: string): Promise<User | null> {
  if (!id) return null;
  return cached(`u:${id}`, 4_000, () => newestJson<User>(usersPrefix(id)));
}

export async function saveUser(user: User): Promise<void> {
  await putJson(`${usersPrefix(user.id)}/${versionKey()}.json`, user);
  invalidate(`u:${user.id}`);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const idx = await newestJson<{ userId: string }>(nameIndexPrefix(username.trim().toLowerCase()));
  if (!idx?.userId) return null;
  return getUser(idx.userId);
}

export async function usernameTaken(username: string): Promise<boolean> {
  const { blobs } = await listPrefix(nameIndexPrefix(username.trim().toLowerCase()), 1);
  return blobs.length > 0;
}

export async function reserveUsername(username: string, userId: string): Promise<void> {
  await putJson(`${nameIndexPrefix(username.trim().toLowerCase())}/${versionKey()}.json`, {
    userId,
    username,
  });
}

export async function searchUsers(term: string, excludeId: string): Promise<PublicUser[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 1) return [];
  const { blobs } = await listPrefix(nameIndexPrefix(q), 12);
  const ids: string[] = [];
  for (const b of blobs) {
    const idx = await readJson<{ userId: string }>(b.url);
    if (idx?.userId && idx.userId !== excludeId) ids.push(idx.userId);
  }
  const users = await Promise.all(ids.slice(0, 12).map((id) => getUser(id)));
  return users
    .filter((u): u is User => Boolean(u))
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      about: u.about,
      avatar: u.avatar,
      lastSeen: u.lastSeen,
    }));
}

/** conversations ----------------------------------------------------------- */

export async function getConv(id: string): Promise<Conv | null> {
  if (!id) return null;
  return cached(`c:${id}`, 5_000, () => newestJson<Conv>(convPrefix(id)));
}

export async function saveConv(conv: Conv): Promise<void> {
  await putJson(`${convPrefix(conv.id)}/${versionKey()}.json`, conv);
  invalidate(`c:${conv.id}`);
}

export async function putMarker(marker: MemberMarker): Promise<void> {
  await putJson(`${memberPrefix(marker.userId)}/${marker.convId}/${versionKey(marker.at)}.json`, marker);
  invalidate(`uc:${marker.userId}`);
}

/** Newest marker per conversation for one user, most recent first. */
export async function listMarkers(userId: string, opts: { includeLeft?: boolean } = {}): Promise<MemberMarker[]> {
  const newestPaths = await cached(`uc:${userId}`, 2_000, async () => {
    const { blobs } = await listPrefix(memberPrefix(userId), 1000);
    // newest version per convId (pathnames sort newest-first within a group)
    const best = new Map<string, { pathname: string; url: string }>();
    for (const b of blobs) {
      const parts = segs(b.pathname);
      const convId = parts[parts.length - 2];
      const cur = best.get(convId);
      if (!cur || b.pathname < cur.pathname) best.set(convId, { pathname: b.pathname, url: b.url });
    }
    return [...best.values()];
  });
  const markers = await Promise.all(
    newestPaths.map((p) => readJson<MemberMarker>(p.url))
  );
  const out = markers.filter((m): m is MemberMarker => Boolean(m));
  const visible = opts.includeLeft ? out : out.filter((m) => !m.left);
  return visible.sort((a, b) => b.at - a.at);
}

/** messages ---------------------------------------------------------------- */

export async function saveMessage(msg: Message): Promise<void> {
  const inv = inverseStamp(msg.at);
  await putJson(`${msgPrefix(msg.convId)}/${inv}-${msg.senderId}-${msg.id}.json`, msg);
  invalidate(`m:${msg.convId}`);
}

export async function getMessageOps(convId: string): Promise<Record<string, MsgOp>> {
  return cached(`mo:${convId}`, 4_000, async () => {
    const { blobs } = await listPrefix(opPrefix(convId), 1000);
    const best = new Map<string, string>();
    for (const b of blobs) {
      const parts = segs(b.pathname);
      const msgId = parts[parts.length - 2];
      const cur = best.get(msgId);
      if (!cur || b.pathname < cur) best.set(msgId, b.pathname);
    }
    const byPath = new Map(blobs.map((b) => [b.pathname, b.url]));
    const ops = await Promise.all(
      [...best.values()].map(async (p) => {
        const url = byPath.get(p);
        return url ? readJson<MsgOp>(url) : null;
      })
    );
    const map: Record<string, MsgOp> = {};
    for (const op of ops) if (op) map[op.msgId] = op;
    return map;
  });
}

export async function saveMessageOp(op: MsgOp): Promise<void> {
  await putJson(`${opPrefix(op.convId)}/${op.msgId}/${versionKey(op.at)}.json`, op);
  invalidate(`mo:${op.convId}`);
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
  const { blobs, cursor, hasMore } = await listPrefix(msgPrefix(convId), limit, opts.cursor);

  let picked = blobs;
  if (opts.since) {
    const boundary = inverseStamp(opts.since);
    picked = blobs.filter((b) => parseMsgPath(b.pathname).inv < boundary);
  }

  const msgs = await Promise.all(picked.map((b) => readJson<Message>(b.url)));
  const ops = await getMessageOps(convId);

  const clean: Message[] = [];
  for (const m of msgs) {
    if (!m) continue;
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
  const { blobs } = await listPrefix(msgPrefix(convId), 1);
  const first = sortNewest(blobs)[0];
  if (!first) return null;
  return readJson<Message>(first.url);
}

/** Unread count for one conversation: messages after `since` not sent by me. */
export async function countUnread(convId: string, userId: string, since: number): Promise<number> {
  return cached(`un:${convId}:${userId}:${since}`, 2_000, async () => {
    const { blobs } = await listPrefix(msgPrefix(convId), 100);
    const boundary = inverseStamp(since);
    let n = 0;
    for (const b of blobs) {
      const p = parseMsgPath(b.pathname);
      if (p.inv < boundary && p.senderId !== userId) n++;
    }
    return n;
  });
}

/** read state -------------------------------------------------------------- */

export async function getReads(userId: string): Promise<Record<string, number>> {
  const state = await cached(`ur:${userId}`, 2_000, () => newestJson<ReadState>(readMapPrefix(userId)));
  return state?.reads ?? {};
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
  const current = await getReads(userId);
  const next = Math.max(current[convId] ?? 0, at);
  if (next === current[convId]) return;
  const reads = { ...current, [convId]: next };
  await putJson(`${readMapPrefix(userId)}/${versionKey()}.json`, {
    userId,
    reads,
    at: Date.now(),
  } satisfies ReadState);
  if (opts.shareReceipt !== false) {
    await putJson(`${convReadPrefix(convId)}/${userId}/${versionKey(at)}.json`, {
      convId,
      userId,
      at: next,
    } satisfies ConvRead);
    invalidate(`r:${convId}`);
  }
  invalidate(`ur:${userId}`);
}

export async function getConvReads(convId: string): Promise<Record<string, number>> {
  return cached(`r:${convId}`, 3_000, async () => {
    const { blobs } = await listPrefix(convReadPrefix(convId), 1000);
    const best = new Map<string, string>();
    for (const b of blobs) {
      const parts = segs(b.pathname);
      const userId = parts[parts.length - 2];
      const cur = best.get(userId);
      if (!cur || b.pathname < cur) best.set(userId, b.pathname);
    }
    const byPath = new Map(blobs.map((b) => [b.pathname, b.url]));
    const rows = await Promise.all(
      [...best.values()].map(async (p) => {
        const url = byPath.get(p);
        return url ? readJson<ConvRead>(url) : null;
      })
    );
    const map: Record<string, number> = {};
    for (const r of rows) if (r) map[r.userId] = r.at;
    return map;
  });
}

/** Aggregates -------------------------------------------------------------- */

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

/* ==========================================================================
   Settings (wallpaper, notifications, privacy, per-chat prefs, blocked list)
   ========================================================================== */

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

export async function getSettings(userId: string): Promise<UserSettings> {
  const stored = await cached(`set:${userId}`, 4_000, () =>
    newestJson<UserSettings>(settingsPrefix(userId))
  );
  if (!stored) return defaultSettings(userId);
  return {
    ...defaultSettings(userId),
    ...stored,
    privacy: { ...defaultSettings(userId).privacy, ...(stored.privacy ?? {}) },
    chatPrefs: stored.chatPrefs ?? {},
    blocked: stored.blocked ?? [],
  };
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const next = { ...settings, at: Date.now() };
  await putJson(`${settingsPrefix(next.userId)}/${versionKey()}.json`, next);
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

/* ==========================================================================
   Reactions, stars, typing, presence, invites
   ========================================================================== */

export async function putReaction(reaction: Reaction): Promise<void> {
  await putJson(
    `${reactionPrefix(reaction.convId)}/${reaction.msgId}/${reaction.userId}/${versionKey(reaction.at)}.json`,
    reaction
  );
  invalidate(`rx:${reaction.convId}`);
}

/** msgId -> userId -> emoji (empty reactions are dropped) */
export async function getReactions(convId: string): Promise<Record<string, Record<string, string>>> {
  return cached(`rx:${convId}`, 2_000, async () => {
    const { blobs } = await listPrefix(reactionPrefix(convId), 1000);
    const best = new Map<string, string>();
    for (const b of blobs) {
      const parts = segs(b.pathname);
      const userId = parts[parts.length - 2];
      const msgId = parts[parts.length - 3];
      const key = `${msgId}|${userId}`;
      const cur = best.get(key);
      if (!cur || b.pathname < cur) best.set(key, b.pathname);
    }
    const byPath = new Map(blobs.map((b) => [b.pathname, b.url]));
    const rows = await Promise.all(
      [...best.entries()].map(async ([key, pathname]) => {
        const url = byPath.get(pathname);
        const rx = url ? await readJson<Reaction>(url) : null;
        return rx ? { key, emoji: rx.emoji } : null;
      })
    );
    const map: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (!row || !row.emoji) continue;
      const [msgId, userId] = row.key.split('|');
      map[msgId] = { ...(map[msgId] ?? {}), [userId]: row.emoji };
    }
    return map;
  });
}

export async function setStar(item: Omit<StarredItem, 'removed'> | null, userId: string, msgId: string) {
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
  await putJson(`${starPrefix(userId)}/${msgId}/${versionKey()}.json`, payload);
  invalidate(`star:${userId}`);
}

export async function getStarred(userId: string): Promise<StarredItem[]> {
  return cached(`star:${userId}`, 3_000, async () => {
    const { blobs } = await listPrefix(starPrefix(userId), 1000);
    const best = new Map<string, string>();
    for (const b of blobs) {
      const parts = segs(b.pathname);
      const msgId = parts[parts.length - 2];
      const cur = best.get(msgId);
      if (!cur || b.pathname < cur) best.set(msgId, b.pathname);
    }
    const byPath = new Map(blobs.map((b) => [b.pathname, b.url]));
    const rows = await Promise.all(
      [...best.values()].map(async (pathname) => {
        const url = byPath.get(pathname);
        return url ? readJson<StarredItem>(url) : null;
      })
    );
    return rows
      .filter((r): r is StarredItem => Boolean(r) && !r!.removed)
      .sort((a, b) => b.at - a.at);
  });
}

export async function setTyping(convId: string, userId: string): Promise<void> {
  const current = await cached(`ty:${convId}`, 1_000, () =>
    newestJson<TypingState>(typingPrefix(convId))
  );
  const users = { ...(current?.users ?? {}), [userId]: Date.now() };
  const cutoff = Date.now() - 20_000;
  for (const [id, at] of Object.entries(users)) if (at < cutoff) delete users[id];
  await putJson(`${typingPrefix(convId)}/${versionKey()}.json`, {
    convId,
    users,
    at: Date.now(),
  } satisfies TypingState);
  invalidate(`ty:${convId}`);
}

/** userIds currently typing (activity within the last 6 seconds) */
export async function getTyping(convId: string): Promise<string[]> {
  const state = await cached(`ty:${convId}`, 900, () =>
    newestJson<TypingState>(typingPrefix(convId))
  );
  const now = Date.now();
  return Object.entries(state?.users ?? {})
    .filter(([, at]) => now - at < 6_000)
    .map(([id]) => id);
}

export async function heartbeat(userId: string): Promise<void> {
  await putJson(`${presencePrefix(userId)}/${versionKey()}.json`, {
    userId,
    at: Date.now(),
  } satisfies Presence);
  invalidate(`pr:${userId}`);
}

export async function getPresence(userId: string): Promise<number> {
  const p = await cached(`pr:${userId}`, 15_000, () =>
    newestJson<Presence>(presencePrefix(userId))
  );
  return p?.at ?? 0;
}

export async function getPresenceMany(ids: string[]): Promise<Record<string, number>> {
  const rows = await Promise.all(ids.map(async (id) => [id, await getPresence(id)] as const));
  return Object.fromEntries(rows);
}

export async function createInvite(convId: string, createdBy: string): Promise<Invite> {
  const invite: Invite = { code: rand(11), convId, createdBy, createdAt: Date.now() };
  await putJson(`${invitePrefix(invite.code)}/${versionKey()}.json`, invite);
  return invite;
}

export async function getInvite(code: string): Promise<Invite | null> {
  if (!/^[a-z0-9]{6,20}$/.test(code)) return null;
  return newestJson<Invite>(invitePrefix(code));
}

/* ==========================================================================
   Search across the user's own conversations
   ========================================================================== */

export type SearchHit = {
  convId: string;
  convName: string;
  convType: ConvType;
  messages: { id: string; text: string; at: number; senderName: string; senderId: string }[];
};

export async function searchMessages(userId: string, query: string, maxConvs = 12): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const markers = (await listMarkers(userId)).slice(0, maxConvs);
  const hits = await Promise.all(
    markers.map(async (m) => {
      const conv = await getConv(m.convId);
      if (!conv) return null;
      const { messages } = await getMessages(m.convId, { limit: 200 });
      const matched = messages
        .filter((msg) => msg.type !== 'system' && msg.text && msg.text.toLowerCase().includes(q))
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
