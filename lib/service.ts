import { newId } from './ids';
import {
  getConv,
  getUser,
  lastMessage,
  listMarkers,
  putMarker,
  saveConv,
  saveMessage,
} from './db';
import type { Conv, Message, User } from './types';

/** Create a 1:1 conversation, or return the existing one. */
export async function ensureDirectConv(me: User, otherId: string): Promise<Conv> {
  for (const m of await listMarkers(me.id)) {
    if (m.convType !== 'direct') continue;
    const conv = await getConv(m.convId);
    if (conv && conv.members.length === 2 && conv.members.includes(otherId)) return conv;
  }
  const now = Date.now();
  const conv: Conv = {
    id: newId('c'),
    type: 'direct',
    name: '',
    avatar: null,
    members: [me.id, otherId],
    admins: [],
    createdBy: me.id,
    createdAt: now,
    disappearSec: 0,
  };
  await saveConv(conv);
  await Promise.all(
    conv.members.map((uid) =>
      putMarker({
        convId: conv.id,
        userId: uid,
        convName: '',
        convType: 'direct',
        convAvatar: null,
        at: now,
        last: null,
      })
    )
  );
  return conv;
}

export async function createGroupConv(
  me: User,
  name: string,
  memberIds: string[]
): Promise<Conv> {
  const members = Array.from(new Set([me.id, ...memberIds])).slice(0, 250);
  const now = Date.now();
  const conv: Conv = {
    id: newId('g'),
    type: 'group',
    name: name.trim().slice(0, 60) || 'New group',
    avatar: null,
    members,
    admins: [me.id],
    createdBy: me.id,
    createdAt: now,
    disappearSec: 0,
  };
  await saveConv(conv);

  const system: Message = {
    id: newId('m'),
    convId: conv.id,
    senderId: me.id,
    senderName: me.displayName,
    at: now,
    type: 'system',
    text: `${me.displayName} created group "${conv.name}"`,
  };
  await saveMessage(system);

  // A group can be created with nobody else in it; tell the creator how to fix that.
  if (members.length === 1) {
    await saveMessage({
      id: newId('m'),
      convId: conv.id,
      senderId: me.id,
      senderName: me.displayName,
      at: now + 1,
      type: 'system',
      text: 'You are the only member. Add people from Group info, or share the invite link.',
    });
  }

  await Promise.all(
    conv.members.map((uid) =>
      putMarker({
        convId: conv.id,
        userId: uid,
        convName: conv.name,
        convType: 'group',
        convAvatar: conv.avatar,
        at: now,
        last: {
          id: system.id,
          text: system.text,
          type: 'text',
          senderId: me.id,
          senderName: me.displayName,
          at: now,
        },
      })
    )
  );
  return conv;
}

function previewFor(msg: Message): string {
  if (msg.type === 'image') return 'Photo';
  if (msg.type === 'audio') return 'Voice message';
  if (msg.type === 'file') return msg.fileName || 'Document';
  if (msg.type === 'location') return 'Location';
  if (msg.type === 'contact') return 'Contact';
  return msg.text;
}

/** Persist a message and refresh every member's conversation index entry. */
export async function deliverMessage(me: User, conv: Conv, msg: Message): Promise<Message> {
  await saveMessage(msg);
  const preview = previewFor(msg);
  await Promise.all(
    conv.members.map((uid) =>
      putMarker({
        convId: conv.id,
        userId: uid,
        convName: conv.name,
        convType: conv.type,
        convAvatar: conv.avatar,
        at: msg.at,
        last: {
          id: msg.id,
          text: preview,
          type: msg.type,
          senderId: me.id,
          senderName: me.displayName,
          at: msg.at,
        },
      })
    )
  );
  return msg;
}

/**
 * Display names for a set of user ids, for use in a system line.
 *
 * An id that no longer resolves becomes "someone" rather than being dropped. An event claiming
 * two people were removed when three were is worse than one with an imprecise name in it.
 */
export async function namesFor(userIds: string[]): Promise<string[]> {
  const users = await Promise.all(userIds.map((id) => getUser(id)));
  return userIds.map((_id, i) => users[i]?.displayName?.trim() || 'someone');
}

/**
 * A readable list of names.
 *
 * Capped, because adding 250 people in one go would otherwise write a line nobody can read —
 * past a handful, the count is the part that matters.
 */
export function describeMembers(names: string[], limit = 5): string {
  const live = names.filter(Boolean);
  if (!live.length) return 'someone';
  if (live.length <= limit) return live.join(', ');
  return `${live.slice(0, limit).join(', ')} and ${live.length - limit} more`;
}

/**
 * Record something that happened to a group — someone was added, removed, joined or left — as
 * a system message in the thread.
 *
 * This goes through deliverMessage rather than writing the message directly, and that is the
 * whole point. A message written on its own would appear in the thread but not in anybody's
 * sidebar preview, so the change would stay silent in the chat list — which is the one place
 * people notice it, because nobody is sitting in the group when it happens.
 *
 * `conv` must be the conversation as it stands AFTER the change. That is what makes the event
 * reach somebody who has just been added, and stay away from somebody who has just been removed.
 */
export async function recordGroupEvent(me: User, conv: Conv, text: string): Promise<Message> {
  return deliverMessage(me, conv, {
    id: newId('m'),
    convId: conv.id,
    senderId: me.id,
    senderName: me.displayName,
    at: Date.now(),
    type: 'system',
    text,
  });
}

/** Copy a message into another conversation (forward). */
export async function forwardMessage(
  me: User,
  target: Conv,
  source: Message
): Promise<Message> {
  const copy: Message = {
    ...source,
    id: newId('m'),
    convId: target.id,
    senderId: me.id,
    senderName: me.displayName,
    at: Date.now(),
    forwarded: true,
    replyTo: null,
  };
  return deliverMessage(me, target, copy);
}

/**
 * Persist a changed conversation and refresh the sidebar entry for every member,
 * preserving the existing last-message preview.
 */
export async function refreshConv(conv: Conv, members = conv.members): Promise<Conv> {
  await saveConv(conv);
  const lastMsg = await lastMessage(conv.id);
  const last = lastMsg
    ? {
        id: lastMsg.id,
        text: previewFor(lastMsg),
        type: lastMsg.type,
        senderId: lastMsg.senderId,
        senderName: lastMsg.senderName,
        at: lastMsg.at,
      }
    : null;
  const at = last?.at ?? Date.now();
  await Promise.all(
    members.map((uid) =>
      putMarker({
        convId: conv.id,
        userId: uid,
        convName: conv.name,
        convType: conv.type,
        convAvatar: conv.avatar,
        at,
        last,
      })
    )
  );
  return conv;
}

/** Hide a conversation from one member's list. */
export async function hideConvFor(conv: Conv, userId: string): Promise<void> {
  await putMarker({
    convId: conv.id,
    userId,
    convName: conv.name,
    convType: conv.type,
    convAvatar: conv.avatar,
    at: conv.createdAt,
    last: null,
    left: true,
  });
}
