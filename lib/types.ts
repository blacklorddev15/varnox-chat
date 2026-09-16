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

export type MessageType = 'text' | 'image' | 'audio' | 'file' | 'system' | 'location' | 'contact';

/**
 * Structured extras for the message types that carry no media: a shared location pin
 * (lat/lng, optional label) or a shared contact card (name/phone).
 */
export type MessagePayload = {
  lat?: number;
  lng?: number;
  label?: string;
  name?: string;
  phone?: string;
};

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
  /**
   * View-once: the recipient can open the attachment a single time. The flag is enforced by
   * the media route refusing to serve the bytes without a token, not by the UI alone.
   */
  once?: boolean;
  /** Structured data for 'location' and 'contact' messages; absent for every other type. */
  payload?: MessagePayload;
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

/**
 * Who may see a user's updates. There is no 'nobody': an update you post is meant to be seen,
 * and 'chats' is the narrowest sensible audience — people you already have a direct chat with.
 */
export type StatusPrivacyWho = 'everyone' | 'chats';

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
    /** Audience for the updates tab; defaults to 'everyone'. */
    statusPrivacy: StatusPrivacyWho;
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
  /**
   * The device this session was issued to. Absent on cookies minted before devices existed,
   * which is why every check on it has to tolerate its absence.
   */
  did?: string;
};

/**
 * One device signed in to an account.
 *
 * `current` is not stored: it describes the device making the request, so the datastore
 * always returns it false and the API marks the caller's own row.
 */
export type Device = {
  id: string;
  label: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: number;
  lastSeen: number;
  current: boolean;
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

/**
 * One short-lived post in the updates tab.
 *
 * `seen` and `viewCount` are relative to whoever asked for it: `seen` says whether *the
 * viewer* has opened it, and `viewCount` is only ever filled in for the viewer's own
 * updates, because only the author may know who watched.
 */
export type Status = {
  id: string;
  userId: string;
  kind: 'text' | 'image';
  text: string | null;
  mediaUrl: string | null;
  bg: string | null;
  createdAt: number;
  expiresAt: number;
  seen: boolean;
  viewCount: number;
};

/** One author's stack of updates, as the feed groups them. */
export type StatusAuthor = {
  user: PublicUser;
  items: Status[];
};

/** One person who watched one of your updates. */
export type StatusViewer = {
  user: PublicUser;
  viewedAt: number;
};

/**
 * One post in a channel.
 *
 * Deliberately plain: no reply, no forward, no view-once and no per-recipient status,
 * because a broadcast is read rather than delivered to anyone in particular.
 */
export type ChannelPost = {
  id: string;
  channelId: string;
  authorId: string;
  kind: 'text' | 'image';
  text: string | null;
  mediaUrl: string | null;
  createdAt: number;
};

/**
 * One broadcast channel, as the signed-in user sees it.
 *
 * The three per-viewer fields are derived on every read rather than stored, so they cannot
 * drift from the rows they describe: `isOwner` decides whether a composer is drawn at all,
 * `following` whether the viewer is offered "follow" or "leave", and `unread` counts posts
 * newer than the viewer's read mark.
 *
 * `lastPost` rides along so the channel list can show a one-line preview without a second
 * request per row, and `lastPostAt` is kept separately because it is what the list sorts and
 * dates a row by even when the post body is not shown.
 */
export type Channel = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  avatar: string | null;
  createdAt: number;
  isOwner: boolean;
  following: boolean;
  followers: number;
  unread: number;
  lastPostAt: number | null;
  lastPost: ChannelPost | null;
};

/** One follower of a channel, as its owner sees them. */
export type ChannelFollower = {
  user: PublicUser;
  followedAt: number;
};

/**
 * One 1:1 call, as the signed-in user sees it.
 *
 * `peer` is always the *other* party, so nothing on the two call screens has to work out which
 * end it is on. `direction`, `missed` and `durationMs` are derived on every read rather than
 * stored, for the same reason `Channel.isOwner` and a status's `expiresAt` are: a derived value
 * cannot drift away from the row it describes.
 *
 * `status` is 'ringing' while it is being offered, 'accepted' once it is up, and 'declined',
 * 'ended' or 'missed' once it is over. A 'ringing' row older than the 45 second window is
 * reported as 'missed' rather than 'ringing' — that derivation happens on read, so no
 * background job is needed to age a call out and a stale row cannot block the next one.
 */
export type Call = {
  id: string;
  callerId: string;
  calleeId: string;
  kind: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endedBy: string | null;
  peer: PublicUser;
  direction: 'incoming' | 'outgoing';
  /** The call was never answered. */
  missed: boolean;
  /** How long the call was up, or null if it never was. */
  durationMs: number | null;
};

/**
 * One message on the signalling channel: the offer and answer that negotiate the session, and
 * the ICE candidates that find a route between the two browsers.
 *
 * `seq` is the cursor a poll asks from, so a reader only ever sees what arrived after the last
 * signal it handled.
 */
export type CallSignal = {
  seq: number;
  kind: 'offer' | 'answer' | 'candidate';
  fromId: string;
  payload: string;
};
