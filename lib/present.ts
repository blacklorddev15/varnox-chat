import { getPresence, getSettings, getUser, type ChatSummary } from './db';
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
  const members = (
    await Promise.all(conv.members.map((id) => presentMember(id, meId)))
  ).filter((u): u is PublicUser => Boolean(u));

  const peerUserId = peerIdOf(conv, meId);
  const peer = peerUserId ? members.find((p) => p.id === peerUserId) ?? null : null;

  return {
    id: conv.id,
    type: conv.type,
    title: conv.type === 'group' ? conv.name : peer?.displayName ?? conv.name ?? 'Chat',
    avatar: conv.type === 'group' ? conv.avatar : peer?.avatar ?? null,
    members: conv.members,
    admins: conv.admins,
    createdBy: conv.createdBy,
    createdAt: conv.createdAt,
    disappearSec: conv.disappearSec ?? 0,
    peer,
    memberProfiles: members,
    last: summary.last,
    unread: summary.unread,
    updatedAt: summary.updatedAt,
    readAt: summary.readAt,
    pinned: summary.pinned,
    muted: summary.muted,
    archived: summary.archived,
  };
}
