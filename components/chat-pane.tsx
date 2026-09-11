'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatRow, Message, PublicUser } from '@/lib/types';
import { dayLabel, presence, timeOfDay } from '@/lib/format';
import { Avatar } from './avatar';
import { Composer } from './composer';
import type { ReplyDraft } from './messenger';
import {
  IconBack,
  IconCheck,
  IconClose,
  IconCopy,
  IconDoubleCheck,
  IconEdit,
  IconLogo,
  IconMoon,
  IconReply,
  IconSun,
  IconTrash,
} from './icons';

type Tick = 'sent' | 'delivered' | 'read';

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

export function ChatPane({
  me,
  chat,
  messages,
  reads,
  hasMore,
  loading,
  sending,
  reply,
  theme,
  boxRef,
  onBack,
  onToggleTheme,
  onOpenInfo,
  onSend,
  onReply,
  onEdit,
  onDelete,
  onLoadOlder,
}: {
  me: PublicUser;
  chat: ChatRow | null;
  messages: Message[];
  reads: Record<string, number>;
  hasMore: boolean;
  loading: boolean;
  sending: boolean;
  reply: ReplyDraft;
  theme: 'dark' | 'light';
  boxRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
  onSend: (text: string, image?: File | null) => void;
  onReply: (draft: ReplyDraft) => void;
  onEdit: (msg: Message, text: string) => void;
  onDelete: (msg: Message) => void;
  onLoadOlder: () => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMenuFor(null);
    setEditing(null);
  }, [chat?.id]);

  if (!chat) {
    return (
      <main className="chat-pane">
        <div className="chat-bg-pattern" />
        <div className="empty">
          <IconLogo size={96} />
          <h1>Varnox</h1>
          <p>
            Send messages, share photos and run group conversations. Pick a chat on the left, or
            start a new one with someone by their username.
          </p>
          <div className="rule" />
          <p style={{ fontSize: 13 }}>
            Your chats stay on your own server. Read receipts show when a message has been delivered
            and read.
          </p>
        </div>
      </main>
    );
  }

  const subtitle =
    chat.type === 'group'
      ? chat.memberProfiles
          .map((p) => (p.id === me.id ? 'You' : p.displayName))
          .slice(0, 4)
          .join(', ') + (chat.memberProfiles.length > 4 ? `, +${chat.memberProfiles.length - 4}` : '')
      : presence(chat.peer?.lastSeen ?? 0);

  return (
    <main className="chat-pane">
      <div className="chat-bg-pattern" />

      <header className="chat-header">
        <button type="button" className="icon-btn back-btn" onClick={onBack} title="Back">
          <IconBack />
        </button>
        <button type="button" onClick={onOpenInfo} style={{ display: 'flex' }}>
          <Avatar name={chat.title} src={chat.avatar} size={40} />
        </button>
        <button type="button" className="who" onClick={onOpenInfo}>
          <h2>{chat.title}</h2>
          <span>{subtitle}</span>
        </button>
        <button type="button" className="icon-btn" onClick={onToggleTheme} title="Theme">
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </header>

      <div className="messages" ref={boxRef}>
        {hasMore ? (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <button type="button" className="btn ghost" onClick={onLoadOlder}>
              Load older messages
            </button>
          </div>
        ) : null}

        {loading ? <div className="loading">Opening conversation…</div> : null}

        {!loading && messages.length === 0 ? (
          <div className="loading" style={{ padding: 30 }}>
            No messages yet — say hello.
          </div>
        ) : null}

        {messages.map((msg, i) => {
          const prev = messages[i - 1];
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

          return (
            <div key={msg.id}>
              {newDay ? <div className="day-chip">{dayLabel(msg.at)}</div> : null}
              <div className={`msg-row${outgoing ? ' out' : ''}`}>
                <div className={`bubble${grouped ? (outgoing ? ' tail-out' : ' tail-in') : ''}${msg.type === 'image' && !msg.text ? ' media' : ''}`}>
                  {!outgoing && !grouped && chat.type === 'group' ? (
                    <div className="sender">{msg.senderName}</div>
                  ) : null}

                  {msg.replyTo ? (
                    <div className="reply">
                      <b>{msg.replyTo.senderName}</b>
                      <span>{msg.replyTo.text || 'Photo'}</span>
                    </div>
                  ) : null}

                  {msg.type === 'image' && msg.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="media"
                      src={msg.mediaUrl}
                      alt="Shared photo"
                      onClick={() => setLightbox(msg.mediaUrl ?? null)}
                    />
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
                            const text = draft.trim();
                            if (text) onEdit(msg, text);
                            setEditing(null);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : msg.text ? (
                    <div className="text">{msg.text}</div>
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

                  {!isEditing ? (
                    <div className="bubble-menu">
                      <button
                        type="button"
                        onClick={() => setMenuFor(menuFor === msg.id ? null : msg.id)}
                        title="Message actions"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <circle cx="6" cy="12" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="18" cy="12" r="1.7" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  {menuFor === msg.id ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 6,
                        bottom: 6,
                        display: 'flex',
                        gap: 4,
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        padding: 3,
                        boxShadow: 'var(--shadow)',
                        zIndex: 5,
                      }}
                    >
                      <button
                        type="button"
                        className="icon-btn"
                        title="Reply"
                        style={{ width: 30, height: 30 }}
                        onClick={() => {
                          onReply({
                            id: msg.id,
                            text: msg.type === 'image' ? 'Photo' : msg.text,
                            senderName: msg.senderName,
                          });
                          setMenuFor(null);
                        }}
                      >
                        <IconReply size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Copy"
                        style={{ width: 30, height: 30 }}
                        onClick={() => {
                          navigator.clipboard?.writeText(msg.text || '').catch(() => undefined);
                          setMenuFor(null);
                        }}
                      >
                        <IconCopy size={15} />
                      </button>
                      {outgoing ? (
                        <>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit"
                            style={{ width: 30, height: 30 }}
                            onClick={() => {
                              setDraft(msg.text);
                              setEditing(msg.id);
                              setMenuFor(null);
                            }}
                          >
                            <IconEdit size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Delete"
                            style={{ width: 30, height: 30, color: 'var(--danger)' }}
                            onClick={() => {
                              onDelete(msg);
                              setMenuFor(null);
                            }}
                          >
                            <IconTrash size={15} />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn"
                        title="Close"
                        style={{ width: 30, height: 30 }}
                        onClick={() => setMenuFor(null)}
                      >
                        <IconClose size={15} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <Composer
        sending={sending}
        reply={reply}
        onClearReply={() => onReply(null)}
        onSend={onSend}
      />

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
