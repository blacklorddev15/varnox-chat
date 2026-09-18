'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRow, Message, MessagePayload, PublicUser, WallpaperId } from '@/lib/types';
import { dayLabel, presence, timeOfDay } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { api, post } from '@/lib/client';
import { Avatar } from './avatar';
import { Composer, type Outgoing } from './composer';
import { VoiceNote } from './voice';
import type { ReplyDraft } from './messenger';
import {
  IconBack,
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconDoc,
  IconDoubleCheck,
  IconEdit,
  IconForward,
  IconGroup,
  IconInfo,
  IconLogo,
  IconMenu,
  IconMoon,
  IconPhone,
  IconReply,
  IconSearch,
  IconSmilePlus,
  IconStar,
  IconSun,
  IconTrash,
  IconVideoCall,
} from './icons';

type Tick = 'sent' | 'delivered' | 'read';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function tickFor(msg: Message, chat: ChatRow, me: PublicUser, reads: Record<string, number>): Tick {
  const others = chat.members.filter((id) => id !== me.id);
  if (others.length === 0) return 'sent';
  if (others.every((id) => (reads[id] ?? 0) >= msg.at)) return 'read';
  const profiles = chat.memberProfiles.filter((p) => p.id !== me.id);
  if (profiles.length > 0 && profiles.every((p) => p.lastSeen >= msg.at)) return 'delivered';
  return 'sent';
}

function dayKey(at: number): string {
  return new Date(at).toDateString();
}

function bytes(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A shared location pin: an OpenStreetMap embed, which needs no API key. */
function LocationBubble({ payload }: { payload: MessagePayload }) {
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return (
      <div className="map-card">
        <span className="hint">Location unavailable</span>
      </div>
    );
  }
  // A small box around the point, so the map opens already centred on it.
  const bbox = [lng - 0.005, lat - 0.004, lng + 0.005, lat + 0.004]
    .map((n) => encodeURIComponent(String(n)))
    .join(',');
  const marker = `${encodeURIComponent(String(lat))},${encodeURIComponent(String(lng))}`;
  return (
    <div className="map-card">
      <iframe
        className="map-frame"
        title="Shared location"
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`}
      />
      <span className="hint">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </span>
      <a
        className="map-open"
        href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(String(lng))}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Maps
      </a>
    </div>
  );
}

/** A shared contact card. "Message" looks the number up and starts a direct chat if it exists. */
function ContactBubble({
  payload,
  onStartChat,
}: {
  payload: MessagePayload;
  onStartChat: (userId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const name = payload.name ?? '';
  const phone = payload.phone ?? '';

  async function start() {
    if (busy || !phone) return;
    setBusy(true);
    setNote('');
    try {
      const res = await api<{ users: PublicUser[] }>(`/api/users?q=${encodeURIComponent(phone)}`);
      const match = res.users.find((u) => u.phone === phone) ?? res.users[0] ?? null;
      if (match) onStartChat(match.id);
      else setNote('Not on Varnox yet');
    } catch {
      setNote('Could not look that number up');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="contact-card">
      <span className="avatar">{(name.trim()[0] ?? '?').toUpperCase()}</span>
      <span className="body">
        <b>{name}</b>
        <span>{formatPhone(phone) || phone}</span>
        {note ? <span className="hint">{note}</span> : null}
      </span>
      <button type="button" className="btn ghost" onClick={start} disabled={busy}>
        Message
      </button>
    </div>
  );
}

function disappearLabel(sec: number): string {
  if (sec === 86_400) return '24 hours';
  if (sec === 604_800) return '7 days';
  if (sec === 7_776_000) return '90 days';
  return `${sec}s`;
}

/**
 * Anything that looks like a link: a scheme, a "www." host, or a bare "name.tld" domain with
 * an optional path. The pattern is deliberately loose — it decides what looks like a link,
 * not what resolves — and it never swallows the punctuation that follows one. The outer
 * group is what makes split() hand the matches back.
 */
const URL_RE =
  /((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]}"']|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^\s<]*[^\s<.,;:!?)\]}"'])?)/gi;

/** A link only starts at a word boundary, and never at the domain of an email address. */
function linkStartsWord(before: string): boolean {
  return !before || !/[\w@]/.test(before);
}

/** A link typed without a scheme is assumed to be https. */
function linkHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Message text with its links made clickable. One regex, split() to keep every other piece
 * exactly as it was written, and a map over the parts: no dependency, no innerHTML, and
 * React escapes the text the same way it always did. Multi-line messages are unaffected —
 * the whitespace and the class names around this stay where they were.
 */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        // The one capturing group puts the matches at the odd indexes.
        if (i % 2 === 0 || !linkStartsWord(parts[i - 1].slice(-1))) return part;
        return (
          <a key={i} href={linkHref(part)} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        );
      })}
    </>
  );
}

export function ChatPane({
  me,
  chat,
  messages,
  reads,
  reactions,
  views,
  typing,
  disappearSec,
  hasMore,
  loading,
  sending,
  reply,
  selection,
  theme,
  wallpaper,
  boxRef,
  blocked,
  onBack,
  onToggleTheme,
  onOpenInfo,
  onVoiceCall,
  onVideoCall,
  onStartChat,
  onSend,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onStar,
  onForward,
  onSelection,
  onBulk,
  onTyping,
  onLoadOlder,
}: {
  me: PublicUser;
  chat: ChatRow | null;
  messages: Message[];
  reads: Record<string, number>;
  reactions: Record<string, Record<string, string>>;
  views: Record<string, string[]>;
  typing: string[];
  disappearSec: number;
  hasMore: boolean;
  loading: boolean;
  sending: boolean;
  reply: ReplyDraft;
  selection: string[];
  theme: 'dark' | 'light';
  wallpaper: WallpaperId;
  boxRef: React.RefObject<HTMLDivElement | null>;
  blocked: boolean;
  onBack: () => void;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
  /**
   * Both are optional and omitted when there is nobody to call, so the buttons simply are not
   * there rather than being present and inert.
   */
  onVoiceCall?: () => void;
  onVideoCall?: () => void;
  /** Opens (or reuses) the direct chat with a user, the same path the new-chat panel takes. */
  onStartChat: (userId: string) => void;
  onSend: (payload: Outgoing) => void;
  onReact: (msg: Message, emoji: string) => void;
  onReply: (draft: ReplyDraft) => void;
  onEdit: (msg: Message, text: string) => void;
  onDelete: (msg: Message) => void;
  onStar: (msg: Message, on: boolean) => void;
  onForward: (ids: string[]) => void;
  onSelection: (ids: string[]) => void;
  onBulk: (action: 'delete' | 'star' | 'unstar') => void;
  onTyping: () => void;
  onLoadOlder: () => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [onceOpened, setOnceOpened] = useState<Record<string, string>>({});
  const [onceNote, setOnceNote] = useState<Record<string, string>>({});
  const [onceBusy, setOnceBusy] = useState('');
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selecting = selection.length > 0;

  useEffect(() => {
    setMenuFor(null);
    setReactFor(null);
    setEditing(null);
    setSearchOpen(false);
    setSearchQ('');
    setOnceOpened({});
    setOnceNote({});
  }, [chat?.id]);

  const shown = useMemo(() => {
    if (!searchOpen || searchQ.trim().length < 1) return messages;
    const q = searchQ.trim().toLowerCase();
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, searchOpen, searchQ]);

  /* View-once attachments are only ever fetched through /open, which hands back a short-lived
     tokenised URL and marks the message spent. The stored mediaUrl is never used as a src. */
  async function openOnce(msg: Message) {
    if (onceBusy) return;
    setOnceBusy(msg.id);
    try {
      const res = await post<{ url: string; mime: string | null; type: string; expiresInSec: number }>(
        `/api/messages/${msg.id}/open`
      );
      setOnceOpened((prev) => ({ ...prev, [msg.id]: res.url }));
      setOnceNote((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      if (msg.type === 'image') setLightbox(res.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setOnceNote((prev) => ({
        ...prev,
        [msg.id]: /already been opened/i.test(message)
          ? 'Already opened'
          : msg.text || 'Could not open that attachment',
      }));
    } finally {
      setOnceBusy('');
    }
  }

  if (!chat) {
    return (
      <main className="chat-pane">
        <div className="chat-bg-pattern" />
        <div className="empty">
          <IconLogo size={104} />
          <h1>Varnox</h1>
          <p>
            Send messages and voice notes, share photos and documents, and run group chats. Pick a
            conversation on the left, or start a new one with someone&apos;s username.
          </p>
          <div className="rule" />
          <p style={{ fontSize: 13 }}>
            Messages are delivered straight from your own Varnox server — with replies, reactions,
            starred messages, disappearing timers and read receipts.
          </p>
        </div>
      </main>
    );
  }

  const typingNames = chat.memberProfiles
    .filter((p) => typing.includes(p.id))
    .map((p) => p.displayName);

  const subtitle = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`
    : chat.type === 'group'
      ? chat.memberProfiles.map((p) => (p.id === me.id ? 'You' : p.displayName)).slice(0, 4).join(', ') +
        (chat.memberProfiles.length > 4 ? `, +${chat.memberProfiles.length - 4}` : '')
      : presence(chat.peer?.lastSeen ?? 0);

  return (
    <main className="chat-pane" data-wall={wallpaper}>
      <div className="chat-bg-pattern" />

      <header className="chat-header">
        <button type="button" className="header-btn back-btn" onClick={onBack} title="Back">
          <IconBack />
        </button>
        <button type="button" onClick={onOpenInfo} style={{ display: 'flex' }}>
          <Avatar name={chat.title} src={chat.avatar} size={40} />
        </button>
        <button type="button" className="who" onClick={onOpenInfo}>
          <h2>{chat.title}</h2>
          <span style={typingNames.length ? { color: '#6ee0bc' } : undefined}>{subtitle}</span>
        </button>
        {onVideoCall ? (
          <button type="button" className="header-btn" title="Video call" onClick={onVideoCall}>
            <IconVideoCall size={20} />
          </button>
        ) : null}
        {onVoiceCall ? (
          <button type="button" className="header-btn" title="Voice call" onClick={onVoiceCall}>
            <IconPhone size={20} />
          </button>
        ) : null}
        <button
          type="button"
          className="header-btn"
          title="More"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <IconMenu size={20} />
        </button>

        {/* Search and the theme switch moved in here. Both still exist, they just no longer
            take up header space next to the call buttons. The theme switch is also in the
            sidebar, so nothing is only reachable from this menu. */}
        {menuOpen ? (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="menu" style={{ top: 'calc(var(--header-h) - 8px)', right: 8, minWidth: 200 }}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSearchOpen(true);
                  setSearchQ('');
                }}
              >
                <IconSearch size={17} /> Search in chat
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInfo();
                }}
              >
                <IconInfo size={17} /> Chat info
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleTheme();
                }}
              >
                {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />} Theme
              </button>
            </div>
          </>
        ) : null}
      </header>

      {searchOpen ? (
        <div className="search-bar">
          <IconSearch size={18} />
          <input
            autoFocus
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search in this chat"
          />
          {searchQ ? (
            <span className="hint">{shown.length} found</span>
          ) : null}
          <button type="button" className="header-btn" onClick={() => setSearchOpen(false)} title="Close">
            <IconClose size={18} />
          </button>
        </div>
      ) : null}

      {disappearSec ? (
        <div className="sys-chip" style={{ margin: '8px auto 0' }}>
          <IconClock size={13} /> Disappearing messages · {disappearLabel(disappearSec)}
        </div>
      ) : null}

      {chat.type === 'group' && chat.members.length === 1 ? (
        <div className="sys-chip" style={{ margin: '8px auto 0' }}>
          <IconGroup size={13} /> You are the only member — add people or share the invite link
        </div>
      ) : null}

      <div className={`messages${selecting ? ' selecting' : ''}`} ref={boxRef}>
        {hasMore && !searchOpen ? (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <button type="button" className="btn ghost" onClick={onLoadOlder}>
              Load older messages
            </button>
          </div>
        ) : null}

        {loading ? <div className="loading">Opening conversation…</div> : null}

        {!loading && !shown.length ? (
          <div className="loading" style={{ padding: 30 }}>
            {searchOpen && searchQ ? 'No messages match that search.' : 'No messages yet — say hello.'}
          </div>
        ) : null}

        {shown.map((msg, i) => {
          const prev = shown[i - 1];
          const outgoing = msg.senderId === me.id;
          const newDay = !prev || dayKey(prev.at) !== dayKey(msg.at);
          const grouped =
            !!prev &&
            !newDay &&
            prev.senderId === msg.senderId &&
            msg.at - prev.at < 5 * 60_000 &&
            prev.type !== 'system' &&
            msg.type !== 'system';

          if (msg.type === 'system') {
            return (
              <div key={msg.id}>
                {newDay ? <div className="day-chip">{dayLabel(msg.at)}</div> : null}
                <div className="sys-chip">{msg.text}</div>
              </div>
            );
          }

          const tick = outgoing ? tickFor(msg, chat, me, reads) : null;
          const isEditing = editing === msg.id;
          const msgReactions = reactions[msg.id] ?? {};
          const reactionEntries = Object.entries(msgReactions);
          const selected = selection.includes(msg.id);
          const onceViewers = views[msg.id] ?? [];
          const onceUrl = onceOpened[msg.id] ?? '';
          const onceByMe = onceViewers.includes(me.id) || Boolean(onceUrl);
          const onceByOthers = onceViewers.some((id) => id !== me.id);
          const onceLabel =
            msg.type === 'audio' ? 'Voice message · view once' : 'Photo · view once';
          const onceState = onceByMe
            ? 'Opened'
            : outgoing
              ? onceByOthers
                ? 'Opened'
                : 'Sent · view once'
              : (onceNote[msg.id] ?? '');

          return (
            <div key={msg.id}>
              {newDay ? <div className="day-chip">{dayLabel(msg.at)}</div> : null}
              <div className={`msg-row${outgoing ? ' out' : ''}`}>
                {selecting ? (
                  <button
                    type="button"
                    className={`sel-circle${selected ? ' on' : ''}`}
                    onClick={() =>
                      onSelection(
                        selected ? selection.filter((id) => id !== msg.id) : [...selection, msg.id]
                      )
                    }
                    title="Select message"
                  >
                    {selected ? <IconCheck size={12} /> : null}
                  </button>
                ) : null}

                <div
                  className={`bubble${grouped ? (outgoing ? ' tail-out' : ' tail-in') : ''}${
                    (msg.type === 'image' && !msg.text) || msg.type === 'audio' ? ' media' : ''
                  }`}
                  onClick={() => {
                    if (selecting) {
                      onSelection(
                        selected ? selection.filter((id) => id !== msg.id) : [...selection, msg.id]
                      );
                    }
                  }}
                >
                  {!outgoing && !grouped && chat.type === 'group' ? (
                    <div className="sender">{msg.senderName}</div>
                  ) : null}

                  {msg.forwarded ? (
                    <div className="forwarded">
                      <IconForward size={13} /> Forwarded
                    </div>
                  ) : null}

                  {msg.replyTo ? (
                    <button
                      type="button"
                      className="reply"
                      onClick={() => {
                        if (selecting) return;
                        onReply({
                          id: msg.replyTo!.id,
                          text: msg.replyTo!.text,
                          senderName: msg.replyTo!.senderName,
                        });
                      }}
                    >
                      <b>{msg.replyTo.senderName}</b>
                      <span>
                        {/*
                          Deliberately plain text. This quote sits inside a <button> that jumps
                          to the quoted message, and an <a> inside a button is invalid markup
                          whose clicks would also fire the jump. Links are still clickable in
                          the bubble body, which is where they belong.
                        */}
                        {msg.replyTo.text || 'Attachment'}
                      </span>
                    </button>
                  ) : null}

                  {msg.type === 'image' && msg.mediaUrl && !msg.once ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="media"
                      src={msg.mediaUrl}
                      alt="Shared photo"
                      onClick={(e) => {
                        if (selecting) return;
                        e.stopPropagation();
                        setLightbox(msg.mediaUrl ?? null);
                      }}
                    />
                  ) : null}

                  {msg.type === 'audio' && msg.mediaUrl && !msg.once ? (
                    <VoiceNote src={msg.mediaUrl} sec={msg.audioSec ?? 0} />
                  ) : null}

                  {msg.once && msg.type === 'audio' && onceUrl ? (
                    <VoiceNote src={onceUrl} sec={msg.audioSec ?? 0} />
                  ) : null}

                  {msg.once && (msg.type === 'image' || msg.type === 'audio') ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minWidth: 200,
                        maxWidth: '100%',
                        padding: '6px 6px 4px',
                        cursor: outgoing || onceByMe ? 'default' : 'pointer',
                        opacity: onceByMe ? 0.75 : 1,
                      }}
                      onClick={(e) => {
                        if (selecting || outgoing || onceByMe) return;
                        e.stopPropagation();
                        openOnce(msg);
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: '1.5px solid currentColor',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: 1,
                          flex: '0 0 auto',
                        }}
                      >
                        1
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <b style={{ fontSize: 13.4 }}>{onceLabel}</b>
                        {onceState ? (
                          <span className="hint" style={{ fontSize: 12.6, lineHeight: 1.35 }}>
                            {onceState}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}

                  {msg.type === 'file' && msg.mediaUrl ? (
                    <a className="file-card" href={msg.mediaUrl} target="_blank" rel="noreferrer" download={msg.fileName}>
                      <span className="ic">
                        <IconDoc size={22} />
                      </span>
                      <span className="body">
                        <b>{msg.fileName}</b>
                        <span>
                          {bytes(msg.fileSize)} · {(msg.mime ?? '').split('/')[1] ?? 'file'}
                        </span>
                      </span>
                    </a>
                  ) : null}

                  {msg.type === 'location' && msg.payload ? (
                    <LocationBubble payload={msg.payload} />
                  ) : null}

                  {msg.type === 'contact' && msg.payload ? (
                    <ContactBubble payload={msg.payload} onStartChat={onStartChat} />
                  ) : null}

                  {isEditing ? (
                    <div style={{ minWidth: 240 }}>
                      <textarea
                        className="input"
                        rows={2}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            const next = draft.trim();
                            if (next) onEdit(msg, next);
                            setEditing(null);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : msg.text ? (
                    <div className="text">
                      <Linkified text={msg.text} />
                    </div>
                  ) : null}

                  <div className="meta">
                    <span>{timeOfDay(msg.at)}</span>
                    {tick === 'sent' ? (
                      <span className="tick">
                        <IconCheck size={14} />
                      </span>
                    ) : null}
                    {tick === 'delivered' ? (
                      <span className="tick">
                        <IconDoubleCheck size={14} />
                      </span>
                    ) : null}
                    {tick === 'read' ? (
                      <span className="tick read">
                        <IconDoubleCheck size={14} />
                      </span>
                    ) : null}
                  </div>

                  {!isEditing && !selecting ? (
                    <div className="bubble-menu">
                      <button
                        type="button"
                        title="React"
                        onClick={() => {
                          setReactFor(reactFor === msg.id ? null : msg.id);
                          setMenuFor(null);
                        }}
                      >
                        <IconSmilePlus size={15} />
                      </button>
                      <button
                        type="button"
                        title="Message actions"
                        onClick={() => {
                          setMenuFor(menuFor === msg.id ? null : msg.id);
                          setReactFor(null);
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <circle cx="12" cy="5" r="1.6" />
                          <circle cx="12" cy="12" r="1.6" />
                          <circle cx="12" cy="19" r="1.6" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  {reactFor === msg.id ? (
                    <div className="quick-react">
                      {QUICK.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            onReact(msg, msgReactions[me.id] === e ? '' : e);
                            setReactFor(null);
                          }}
                        >
                          {e}
                        </button>
                      ))}
                      <button type="button" onClick={() => setReactFor(null)} title="Close">
                        <IconClose size={14} />
                      </button>
                    </div>
                  ) : null}

                  {menuFor === msg.id ? (
                    <div className="menu" style={{ top: 30, right: 4, minWidth: 190 }}>
                      <button
                        type="button"
                        onClick={() => {
                          onReply({
                            id: msg.id,
                            text: msg.type === 'text' ? msg.text : msg.fileName || 'Attachment',
                            senderName: msg.senderName,
                          });
                          setMenuFor(null);
                        }}
                      >
                        <IconReply size={17} /> Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onForward([msg.id]);
                          setMenuFor(null);
                        }}
                      >
                        <IconForward size={17} /> Forward
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onStar(msg, true);
                          setMenuFor(null);
                        }}
                      >
                        <IconStar size={17} /> Star
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(msg.text || '').catch(() => undefined);
                          setMenuFor(null);
                        }}
                      >
                        <IconCopy size={17} /> Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInfoFor(msg);
                          setMenuFor(null);
                        }}
                      >
                        <IconInfo size={17} /> Message info
                      </button>
                      {outgoing ? (
                        <>
                          <div className="sep" />
                          <button
                            type="button"
                            onClick={() => {
                              setDraft(msg.text);
                              setEditing(msg.id);
                              setMenuFor(null);
                            }}
                          >
                            <IconEdit size={17} /> Edit
                          </button>
                          <button
                            type="button"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => {
                              onDelete(msg);
                              setMenuFor(null);
                            }}
                          >
                            <IconTrash size={17} /> Delete for everyone
                          </button>
                        </>
                      ) : null}
                      <div className="sep" />
                      <button
                        type="button"
                        onClick={() => {
                          onSelection([msg.id]);
                          setMenuFor(null);
                        }}
                      >
                        <IconCheck size={17} /> Select
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {reactionEntries.length ? (
                <div className={`react-row${outgoing ? ' out' : ''}`}>
                  {reactionEntries.map(([userId, emoji]) => (
                    <button
                      key={userId}
                      type="button"
                      className={`react-chip${userId === me.id ? ' mine' : ''}`}
                      title={
                        chat.memberProfiles.find((p) => p.id === userId)?.displayName ?? 'Someone'
                      }
                      onClick={() => onReact(msg, userId === me.id ? '' : emoji)}
                    >
                      {emoji}
                      <b>{reactionEntries.length}</b>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {selecting ? (
        <div className="sel-bar">
          <button type="button" className="header-btn" onClick={() => onSelection([])} title="Cancel">
            <IconClose size={20} />
          </button>
          <span className="count">{selection.length} selected</span>
          <button type="button" className="header-btn" title="Star" onClick={() => onBulk('star')}>
            <IconStar size={20} />
          </button>
          <button type="button" className="header-btn" title="Forward" onClick={() => onForward(selection)}>
            <IconForward size={20} />
          </button>
          <button
            type="button"
            className="header-btn"
            title="Copy"
            onClick={() => {
              const text = messages
                .filter((m) => selection.includes(m.id))
                .map((m) => m.text)
                .join('\n');
              navigator.clipboard?.writeText(text).catch(() => undefined);
              onSelection([]);
            }}
          >
            <IconCopy size={20} />
          </button>
          <button
            type="button"
            className="header-btn"
            title="Delete for everyone"
            style={{ color: 'var(--danger)' }}
            onClick={() => onBulk('delete')}
          >
            <IconTrash size={20} />
          </button>
        </div>
      ) : (
        <Composer
          sending={sending}
          reply={reply}
          onClearReply={() => onReply(null)}
          onSend={onSend}
          onTyping={onTyping}
          blocked={blocked}
        />
      )}

      {infoFor ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setInfoFor(null)}>
          <div className="sheet">
            <div className="sheet-head">
              <h3>Message info</h3>
              <button type="button" className="header-btn" onClick={() => setInfoFor(null)}>
                <IconClose />
              </button>
            </div>
            <div className="sheet-body">
              <p className="hint">
                Sent {timeOfDay(infoFor.at)} · {dayLabel(infoFor.at)}
              </p>
              {chat.memberProfiles
                .filter((p) => p.id !== me.id)
                .map((p) => {
                  const delivered = (p.lastSeen ?? 0) >= infoFor.at;
                  const read = (reads[p.id] ?? 0) >= infoFor.at;
                  return (
                    <div key={p.id} className="member-row">
                      <Avatar name={p.displayName} src={p.avatar} size={40} />
                      <span className="body">
                        <b>{p.displayName}</b>
                        <span>{read ? 'Read' : delivered ? 'Delivered' : 'Sent'}</span>
                      </span>
                      {read ? <IconDoubleCheck size={16} className="tick read" /> : null}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div className="overlay" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Shared photo"
            style={{ maxWidth: '92vw', maxHeight: '88dvh', borderRadius: 10 }}
          />
        </div>
      ) : null}
    </main>
  );
}
