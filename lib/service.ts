import { newId } from './blob';
import {
  getConv,
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
