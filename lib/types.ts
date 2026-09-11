// Shared domain types for Varnox

export type User = {
  id: string;
  username: string;
  displayName: string;
  about: string;
  avatar: string | null;
  pwHash: string;
  createdAt: number;
  lastSeen: number;
};

/** Public projection of a user (never leaks password material). */
export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  about: string;
  avatar: string | null;
  lastSeen: number;
};

export type ConvType = 'direct' | 'group';

export type Conv = {
  id: string;
  type: ConvType;
  name: string;
  avatar: string | null;
  members: string[];
  admins: string[];
  createdBy: string;
  createdAt: number;
};

export type LastMsg = {
  id: string;
  text: string;
  type: 'text' | 'image';
  senderId: string;
  senderName: string;
  at: number;
};

/** Per-user index entry for one conversation. Append-only, newest version wins. */
export type MemberMarker = {
  convId: string;
  userId: string;
  convName: string;
  convType: ConvType;
  convAvatar: string | null;
  at: number;
  last: LastMsg | null;
  /** true when the user left or was removed — newest marker wins, so it hides the chat */
  left?: boolean;
};

export type MessageType = 'text' | 'image' | 'system';

export type Message = {
  id: string;
  convId: string;
  senderId: string;
  senderName: string;
  at: number;
  type: MessageType;
  text: string;
  mediaUrl?: string;
  mediaW?: number;
  mediaH?: number;
  replyTo?: { id: string; text: string; senderName: string } | null;
};

/** Deferred edit / delete op. Newest op per message wins. */
export type MsgOp = {
  convId: string;
  msgId: string;
  op: 'edit' | 'delete';
  text?: string;
  at: number;
};

/** Per-user read state map: convId -> timestamp up to which the user has read. */
export type ReadState = {
  userId: string;
  reads: Record<string, number>;
  at: number;
};

/** Per-conversation read receipt from one member. */
export type ConvRead = {
  convId: string;
  userId: string;
  at: number;
};

export type SessionPayload = {
  uid: string;
  exp: number;
};

/** Shape returned by the API for one conversation in the sidebar. */
export type ChatRow = {
  id: string;
  type: ConvType;
  title: string;
  avatar: string | null;
  members: string[];
  admins: string[];
  createdBy: string;
  createdAt: number;
  peer: PublicUser | null;
  memberProfiles: PublicUser[];
  last: LastMsg | null;
  unread: number;
  updatedAt: number;
  readAt: number;
};
