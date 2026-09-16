// Shared domain types for Varnox

export type User = {
  id: string;
  username: string;
  /** Canonical "+<digits>" login identifier. Null only for accounts made before phone login existed. */
  phone: string | null;
  /** Lowercased address, unique when present. Not yet verified by any proof of ownership. */
  email: string | null;
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
  phone: string | null;
  /** Returned to the account holder for their own profile; other users never see it. */
  email: string | null;
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
  /** Disappearing messages: seconds after which messages vanish (0 = off). */
  disappearSec: number;
};

export type LastMsg = {
  id: string;
  text: string;
  type: MessageType;
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

export type MessageType = 'text' | 'image' | 'audio' | 'file' | 'system';

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
  /** voice note length in seconds */
  audioSec?: number;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  forwarded?: boolean;
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

/** Emoji reaction. An empty emoji means the reaction was removed. */
export type Reaction = {
  convId: string;
  msgId: string;
  userId: string;
  emoji: string;
  at: number;
};

/** A message the user starred, with enough of a snapshot to render it later. */
export type StarredItem = {
  userId: string;
  msgId: string;
  convId: string;
  convName: string;
  at: number;
  /** newest version wins, so unstarring writes a tombstone at a later timestamp */
  removed?: boolean;
  snapshot: {
    text: string;
    type: MessageType;
    senderName: string;
    at: number;
    mediaUrl?: string;
    fileName?: string;
  };
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

export type WallpaperId = 'doodle' | 'plain' | 'dots' | 'grid' | 'leaf';

export type PrivacyWho = 'everyone' | 'contacts' | 'nobody';

export type ChatPrefs = {
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
};

export type UserSettings = {
  userId: string;
  wallpaper: WallpaperId;
  notifications: boolean;
  privacy: {
    lastSeen: PrivacyWho;
    profilePhoto: PrivacyWho;
    readReceipts: boolean;
  };
  chatPrefs: Record<string, ChatPrefs>;
  blocked: string[];
  at: number;
};

export type TypingState = {
  convId: string;
  users: Record<string, number>;
  at: number;
};

export type Presence = {
  userId: string;
  at: number;
};

export type Invite = {
  code: string;
  convId: string;
  createdBy: string;
  createdAt: number;
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
  disappearSec: number;
  peer: PublicUser | null;
  memberProfiles: PublicUser[];
  last: LastMsg | null;
  unread: number;
  updatedAt: number;
  readAt: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
};
