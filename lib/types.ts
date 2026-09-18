// Shared domain types for Varnox

export type User = {
  id: string;
  username: string;
  /** Canonical "+<digits>" login identifier. Null only for accounts made before phone login existed. */
  phone: string | null;
  /** Lowercased address, unique when present. */
  email: string | null;
  /**
   * When the address was confirmed by a code, or null while it is unproved.
   *
   * Separate from `email` because an address can be present and wrong. Accounts made before
   * this existed, and addresses never confirmed since, both read null — which is the same
   * thing: nothing has ever checked them.
   */
  emailVerifiedAt: number | null;
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
  /** Owner only, on the same rule as the address itself. Null for anybody else's profile. */
  emailVerifiedAt: number | null;
  displayName: string;
  about: string;
  avatar: string | null;
  lastSeen: number;
};

/**
 * Why an account cannot use the app, and whether its owner has asked for that to be looked at.
 *
 * Separate from deletion on purpose. Deletion is the account leaving for good; suspension is a
 * lockout that ends, and the account is expected back. Neither removes anything — the rows, the
 * messages and the chats stay where they are in both cases.
 *
 * The account can still sign in far enough to be shown this, which is the point: a silent
 * sign-out looks like a broken app and leaves nowhere to ask for a review.
 */
export type Suspension = {
  /** When the suspension was applied. */
  at: number;
  /** The note recorded when suspending, shown to the suspended account. Null if none was left. */
  reason: string | null;
  /** When the account last asked for a review, or null if it never has. */
  reviewRequestedAt: number | null;
  /**
   * When the suspension lifts on its own, or null when it has no end.
   *
   * A date here means the owner chose a length and the account lifts by itself when it arrives —
   * no appeal needed, and none will shorten it. Null is the older behaviour: blocked until
   * somebody lifts it, with the appeal ladder as the way out.
   */
  until: number | null;
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

export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'system'
  | 'location'
  | 'contact';

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
  /**
   * The person being called on a one-to-one call.
   *
   * On a group call this holds the **first person invited** — a real participant, not a
   * placeholder. It stays populated because the one-to-one call screens are built around it and
   * should not have to care that group calls exist. Use `isGroup` to tell the two apart, and
   * `participants` for everybody on the call.
   */
  calleeId: string;
  /**
   * More than two people were invited. True even when only one person was, because a call
   * started from a group is a different thing from a call started against one contact — it has
   * a roster, and one person leaving does not end it.
   */
  isGroup: boolean;
  kind: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endedBy: string | null;
  /**
   * Who this call is "about" for the one-to-one screens: the other party. On a group call there
   * is no such person, so this is the caller for anybody who did not start it, and the first
   * other participant for whoever did. It is a compatibility field — a group call should draw
   * `participants`, not this.
   */
  peer: PublicUser;
  /**
   * Everyone on the call: the caller first, then everybody invited. Always populated, including
   * for calls made before group calls existed, whose list is synthesised from callerId and
   * calleeId.
   *
   * One-to-one calls have exactly two entries, so `participants.length > 2` is what tells a
   * screen it is looking at a group call.
   */
  participants: CallParticipant[];
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
/** Where somebody is in a call. */
export type CallParticipantState = 'invited' | 'joined' | 'left' | 'declined';

/**
 * One person on a call, and how far they got with it.
 *
 * The state is carried because a group call needs it and a one-to-one call never did: on a
 * one-to-one call, "who is on it" and "who was asked" are the same two people. With three or
 * more, a screen has to tell apart the people who are actually there from the ones still being
 * rung and the ones who have already gone.
 *
 * The list is deliberately not filtered down to the live ones. History needs everybody — a
 * finished call has nobody 'joined' at all, so filtering here would erase it from the list.
 */
export type CallParticipant = {
  user: PublicUser;
  state: CallParticipantState;
};

export type CallSignal = {
  seq: number;
  kind: 'offer' | 'answer' | 'candidate';
  fromId: string;
  /**
   * Who the signal is for. An offer and an ICE candidate belong to one specific peer, so on a
   * call with three or more people a signal has to say which. Null means "whoever else is on
   * the call", which is how one-to-one signalling worked before this field existed and how
   * those older rows still read.
   */
  toId: string | null;
  payload: string;
};

/**
 * One "Link WhatsApp" request, as the pairing screen sees it.
 *
 * `status` is whatever the external bot has written — 'pending', 'processing',
 * 'code_generated', 'connected', 'failed' or 'expired'. Any other value is passed through
 * untouched rather than mapped, so a bot that grows a new state shows it raw instead of
 * crashing the screen.
 *
 * `code` is only present once the bot has written it, and is only shown while the status is
 * 'code_generated'. `expiresAt` is the moment the request stops being claimable.
 */
export type WhatsAppPairing = {
  id: number;
  phone: string;
  status: string;
  code: string | null;
  error: string | null;
  expiresAt: number;
  createdAt: number;
};

/**
 * One WhatsApp number linked to the account.
 *
 * `id` is the bot's session id — always the literal string 'web_' followed by the phone
 * number, which is also how the row is attributed to a user. `status` is the bot's last word
 * on the session: 'connected', or 'disconnected' once it has gone away. A disconnected row is
 * dropped from the list rather than deleted.
 */
export type WhatsAppSession = {
  id: string;
  phone: string;
  status: string;
  updatedAt: number;
};

/**
 * One line in the bot thread: either something typed here, or the bot's answer.
 *
 * `direction` is what lets the screen render both from a single list — 'in' is a message this
 * user typed, 'out' is what the bot replied.
 *
 * `state` only means anything for 'in', and it is how the screen explains a message that has
 * not been answered yet. That is not decoration: a message written while the bot host is down
 * sits 'pending' and then turns 'failed' with a reason, which is the difference between "wait a
 * moment" and "this is not going to happen". Saying nothing at all leaves somebody watching a
 * thread that will never move.
 */
export type BotThreadMessage = {
  direction: 'in' | 'out';
  id: number;
  body: string;
  /** 'text', 'image', 'reaction', 'note' … — what kind of thing the bot sent back. */
  kind: string;
  state: 'pending' | 'claimed' | 'done' | 'failed' | null;
  error: string | null;
  /**
   * Set when this reply carried a picture. Fetch it from /api/bot/media/<id>, which serves it
   * only to an account whose own thread references it — media is stored once by content hash
   * and shared between threads, so the row alone is not permission to read it.
   */
  mediaId: number | null;
  /** Store size in bytes, so the screen can decide before fetching. */
  mediaBytes: number | null;
  at: number;
};

/**
 * A bot this account owns, as the Bots screen sees it.
 *
 * There is no field for the Varnox API token or for the Telegram bot token, and that absence is
 * the design rather than an omission. The Varnox token is shown once at creation and only its
 * hash is kept, so there is nothing to put here. The Telegram token is sealed in the database
 * and opened only inside a server route that is about to call Telegram, so it has no business in
 * a type that describes an API response.
 *
 * What is here instead is what the token *is*, which is the question the screen actually asks:
 * whether a Telegram token is on file (`hasTelegram`), which bot Telegram said it was on the last
 * test (`telegramBotId`, `telegramUsername`) and when that answer was given
 * (`telegramCheckedAt`). Those are facts about the credential, not the credential.
 */
export type Bot = {
  id: string;
  name: string;
  /**
   * The bot's Varnox username — unique across the whole app, lowercase, and the name the account
   * chose to tell this bot from its others.
   *
   * Null only for a row written before the column existed. Every bot created through the wizard
   * has one, and the wizard is the only way to create one.
   *
   * Distinguished from `telegramUsername`, which is Telegram's own @name for the bot, discovered
   * by the getMe test and not reserved by Varnox at all. Two fields because they are two
   * different facts, and a single `username` would make it impossible to tell which one is set.
   */
  handle: string | null;
  description: string;
  /**
   * The owner's own switch. Turning it off stops the token authenticating anything — see
   * botForToken() in lib/bots.ts — which is what an owner expects a switch labelled active to do.
   */
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** Whether a Telegram bot token is stored for this bot. Never the token itself. */
  hasTelegram: boolean;
  telegramBotId: string | null;
  telegramUsername: string | null;
  /** When getMe last confirmed the token, or null if it never has. */
  telegramCheckedAt: number | null;
  /**
   * When the Varnox API token currently issued to this bot was created, or null when none is
   * live. A revoked token leaves this null, which is how the screen knows to show it as revoked
   * rather than as never issued.
   */
  tokenIssuedAt: number | null;
  /** When the most recent token was revoked, or null if none ever was. */
  tokenRevokedAt: number | null;
};

/**
 * The only shape in the app that carries a plaintext Varnox token.
 *
 * It exists for exactly one response — the one answering the create request — and nowhere else.
 * A named type rather than an inline object so that "which responses carry a token" is a
 * question answerable by searching for this name.
 */
export type CreatedBot = {
  bot: Bot;
  /** Shown once. Only the hash was stored, so this value cannot be recovered later. */
  token: string;
};

/**
 * A message in a conversation between an account and one of its bots.
 *
 * `direction` rather than two types, because a reader almost always wants both interleaved — the
 * thread view draws them in order and the bot's context is "the last N, either way".
 *
 * There is no `status` here. That field exists for the bot's inbox, and it is the bot's business
 * rather than the reader's: whether a message has been claimed yet is not something the person who
 * typed it should ever be shown. The Bots screen shows `pending` on the thread, which is the
 * question a person actually has — has my bot answered?
 */
export type BotMessageDirection = 'in' | 'out';

export type BotMessage = {
  id: string;
  direction: BotMessageDirection;
  body: string;
  createdAt: number;
};

/**
 * A conversation with a bot, as the list shows it.
 *
 * The last-message fields are null for a thread that exists but has nothing in it — which is a real
 * state, not a missing one: START creates the thread and queues `/start`, and if the bot's process
 * is not running yet there will be a thread with no reply. Distinguishing that from "no thread"
 * is what lets the screen say "started, waiting" instead of looking like START did nothing.
 */
export type BotThread = {
  botId: string;
  createdAt: number;
  updatedAt: number;
  lastBody: string | null;
  lastDirection: BotMessageDirection | null;
  lastAt: number | null;
  /** Messages from the account that the bot has not answered yet. */
  pending: number;
};
