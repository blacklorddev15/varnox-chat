import { getUser, type ChatSummary } from './db';
import type { ChatRow, Conv, PublicUser } from './types';

export type { ChatRow };

export function peerIdOf(conv: Conv, meId: string): string | null {
  if (conv.type !== 'direct') return null;
  return conv.members.find((m) => m !== meId) ?? null;
}

/** Build display rows, resolving member profiles (cached per request via getUser). */
export async function buildChatRow(meId: string, summary: ChatSummary): Promise<ChatRow> {
  const conv = summary.conv;
  const profiles = (
    await Promise.all(conv.members.map((id) => getUser(id)))
  ).filter((u): u is NonNullable<typeof u> => Boolean(u));

  const publicProfiles: PublicUser[] = profiles.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    about: u.about,
    avatar: u.avatar,
    lastSeen: u.lastSeen,
  }));

  const peerUserId = peerIdOf(conv, meId);
  const peer = peerUserId ? publicProfiles.find((p) => p.id === peerUserId) ?? null : null;

  return {
    id: conv.id,
    type: conv.type,
    title: conv.type === 'group' ? conv.name : peer?.displayName ?? conv.name ?? 'Chat',
    avatar: conv.type === 'group' ? conv.avatar : peer?.avatar ?? null,
    members: conv.members,
    admins: conv.admins,
    createdBy: conv.createdBy,
    createdAt: conv.createdAt,
    peer,
    memberProfiles: publicProfiles,
    last: summary.last,
    unread: summary.unread,
    updatedAt: summary.updatedAt,
    readAt: summary.readAt,
  };
}
