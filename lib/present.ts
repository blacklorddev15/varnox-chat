import { getPresence, getSettings, getUser, liveUserIds, type ChatSummary } from './db';
import type { ChatRow, Conv, PublicUser } from './types';

export type { ChatRow };

/** A summary with no messages yet — used right after creating or joining a chat. */
export function emptySummary(conv: Conv, at = Date.now()): ChatSummary {
  return {
    conv,
    last: null,
    unread: 0,
    readAt: 0,
    updatedAt: at,
    pinned: false,
    muted: false,
    archived: false,
  };
}

export function peerIdOf(conv: Conv, meId: string): string | null {
  if (conv.type !== 'direct') return null;
  return conv.members.find((m) => m !== meId) ?? null;
}

/**
 * Resolve a member for display, applying their privacy settings:
 * "nobody" hides last seen / photo from everyone else.
 */
export async function presentMember(id: string, viewerId: string): Promise<PublicUser | null> {
  const [user, presence, settings] = await Promise.all([
    getUser(id),
    getPresence(id),
    getSettings(id),
  ]);
  if (!user) return null;
  const isSelf = id === viewerId;
  const showLastSeen = isSelf || settings.privacy.lastSeen !== 'nobody';
  const showPhoto = isSelf || settings.privacy.profilePhoto !== 'nobody';
  return {
    id: user.id,
    username: user.username,
    phone: user.phone ?? null,
    // Only ever your own address. An email is not a contact detail you publish by signing
    // up, so other members — and search results — get null regardless of privacy settings.
    email: isSelf ? (user.email ?? null) : null,
    displayName: user.displayName,
    about: user.about,
    avatar: showPhoto ? user.avatar : null,
    lastSeen: showLastSeen ? Math.max(user.lastSeen, presence) : 0,
  };
}

/** Build a display row for the sidebar or a chat header. */
export async function buildChatRow(meId: string, summary: ChatSummary): Promise<ChatRow> {
  const conv = summary.conv;
  const profiles = await Promise.all(conv.members.map((id) => presentMember(id, meId)));

  /**
   * Which members have deleted their account.
   *
   * A deleted account reads as having left the group: it is gone from the member list, from the
   * count and from the admin list together, because those are three views of one array. Leaving
   * the id in `members` would keep a name in "Group · 4 members" that resolves to nobody, and
   * the count is the part people actually read.
   *
   * Only groups are filtered, and a one-to-one chat is the deliberate exception. That thread and
   * its history stay, and its title is the other person's name — so dropping the peer would
   * relabel an existing conversation as "Chat" and lose the one thing identifying it. Not being
   * reachable is enforced where contact is made instead: the directory, search, and the route
   * that creates a direct chat.
   *
   * Asked here rather than inside presentMember for the same reason: presentMember also builds
   * that direct-chat peer, which must keep resolving.
   */
  const live = conv.type === 'group' ? await liveUserIds(conv.members) : null;
  const left = (id: string) => live !== null && !live.has(id);

  // `u !== null` rather than Boolean(u): the body now reads u.id, and a function call in the
  // condition does not narrow the parameter for the rest of the expression.
  const memberProfiles = profiles.filter((u): u is PublicUser => u !== null && !left(u.id));
  const members = conv.members.filter((id) => !left(id));

  const peerUserId = peerIdOf(conv, meId);
  const peer = peerUserId ? memberProfiles.find((p) => p.id === peerUserId) ?? null : null;

  return {
    id: conv.id,
    type: conv.type,
    title: conv.type === 'group' ? conv.name : peer?.displayName ?? conv.name ?? 'Chat',
    avatar: conv.type === 'group' ? conv.avatar : peer?.avatar ?? null,
    members,
    admins: conv.admins.filter((id) => !left(id)),
    createdBy: conv.createdBy,
    createdAt: conv.createdAt,
    disappearSec: conv.disappearSec ?? 0,
    peer,
    memberProfiles,
    last: summary.last,
    unread: summary.unread,
    updatedAt: summary.updatedAt,
    readAt: summary.readAt,
    pinned: summary.pinned,
    muted: summary.muted,
    archived: summary.archived,
  };
}
