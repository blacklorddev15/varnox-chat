import {
  ROOT,
  cached,
  invalidate,
  listAll,
  listPrefix,
  newestJson,
  putJson,
  readJson,
  sortNewest,
  versionKey,
} from './blob';
import type {
  Conv,
  ConvRead,
  MemberMarker,
  Message,
  MsgOp,
  PublicUser,
  ReadState,
  User,
} from './types';

const usersPrefix = (id: string) => `${ROOT}/u/${id}`;
const nameIndexPrefix = (usernameLower: string) => `${ROOT}/n/${usernameLower}`;
const convPrefix = (id: string) => `${ROOT}/c/${id}`;
const memberPrefix = (userId: string) => `${ROOT}/uc/${userId}`;
const msgPrefix = (convId: string) => `${ROOT}/m/${convId}`;
const opPrefix = (convId: string) => `${ROOT}/mo/${convId}`;
const readMapPrefix = (userId: string) => `${ROOT}/ur/${userId}`;
const convReadPrefix = (convId: string) => `${ROOT}/r/${convId}`;

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
  opts: { limit?: number; cursor?: string; since?: number } = {}
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

export async function markRead(userId: string, convId: string, at: number): Promise<void> {
  const current = await getReads(userId);
  const next = Math.max(current[convId] ?? 0, at);
  if (next === current[convId]) return;
  const reads = { ...current, [convId]: next };
  await putJson(`${readMapPrefix(userId)}/${versionKey()}.json`, {
    userId,
    reads,
    at: Date.now(),
  } satisfies ReadState);
  await putJson(`${convReadPrefix(convId)}/${userId}/${versionKey(at)}.json`, {
    convId,
    userId,
    at: next,
  } satisfies ConvRead);
  invalidate(`ur:${userId}`);
  invalidate(`r:${convId}`);
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
};

export async function chatSummaries(userId: string): Promise<ChatSummary[]> {
  const markers = await listMarkers(userId);
  const reads = await getReads(userId);
  const rows = await Promise.all(
    markers.map(async (m) => {
      const conv = await getConv(m.convId);
      if (!conv) return null;
      const readAt = reads[m.convId] ?? 0;
      const unread =
        m.last && m.last.senderId !== userId && m.last.at > readAt
          ? await countUnread(m.convId, userId, readAt)
          : 0;
      return { conv, last: m.last, unread, readAt, updatedAt: m.at } as ChatSummary;
    })
  );
  return rows
    .filter((r): r is ChatSummary => Boolean(r))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
