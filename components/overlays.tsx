'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { ChatRow, StarredItem } from '@/lib/types';
import { dayLabel, timeOfDay } from '@/lib/format';
import { Avatar } from './avatar';
import { IconClose, IconDoc, IconForward, IconImage, IconMic, IconSearch, IconStar } from './icons';

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="header-btn" onClick={onClose} title="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function StarredPanel({
  items,
  onClose,
  onOpenChat,
}: {
  items: StarredItem[];
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  return (
    <Shell title="Starred messages" onClose={onClose}>
      {items.length === 0 ? (
        <p className="hint">
          No starred messages yet. Open a message&apos;s menu and pick <b>Star</b> to keep it here.
        </p>
      ) : (
        items.map((item) => (
          <button
            key={item.msgId}
            type="button"
            className="pick-row"
            style={{ alignItems: 'flex-start' }}
            onClick={() => item.convId && onOpenChat(item.convId)}
          >
            <span className="ic" style={{ width: 26, display: 'inline-flex', color: 'var(--brand)' }}>
              <IconStar size={18} filled />
            </span>
            <span className="body">
              <b>
                {item.snapshot.senderName || 'Message'} · {item.convName}
              </b>
              <span>
                {item.snapshot.type === 'image'
                  ? 'Photo'
                  : item.snapshot.type === 'audio'
                    ? 'Voice message'
                    : item.snapshot.type === 'file'
                      ? item.snapshot.fileName || 'Document'
                      : item.snapshot.text}
              </span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11.8 }}>
                {dayLabel(item.snapshot.at)} · {timeOfDay(item.snapshot.at)}
              </span>
            </span>
          </button>
        ))
      )}
    </Shell>
  );
}

type SearchResults = {
  query: string;
  results: {
    convId: string;
    convType: 'direct' | 'group';
    title: string;
    messages: { id: string; text: string; at: number; senderName: string }[];
  }[];
};

export function SearchPanel({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      return;
    }
    let alive = true;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`);
        if (alive) setData(res);
      } catch {
        if (alive) setData({ query, results: [] });
      } finally {
        if (alive) setBusy(false);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  return (
    <Shell title="Search messages" onClose={onClose}>
      <div className="search-box" style={{ marginBottom: 12 }}>
        <IconSearch size={18} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search across your chats"
        />
      </div>

      {q.trim().length < 2 ? (
        <p className="hint">Type at least two characters to search the text of your messages.</p>
      ) : busy && !data ? (
        <p className="hint">Searching…</p>
      ) : !data || data.results.length === 0 ? (
        <p className="hint">No messages match “{q.trim()}”.</p>
      ) : (
        data.results.map((group) => (
          <div key={group.convId} style={{ marginBottom: 10 }}>
            <div className="list-label" style={{ padding: '4px 4px 6px' }}>
              {group.title}
            </div>
            {group.messages.map((m) => (
              <button
                key={m.id}
                type="button"
                className="search-hit"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => onOpenChat(group.convId)}
              >
                <b>
                  {m.senderName} · {dayLabel(m.at)} {timeOfDay(m.at)}
                </b>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </Shell>
  );
}

export function ForwardPanel({
  chats,
  onClose,
  onForward,
}: {
  chats: ChatRow[];
  onClose: () => void;
  onForward: (targets: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const candidates = chats.filter((c) => !c.archived);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>Forward to</h3>
          <button type="button" className="header-btn" onClick={onClose} title="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          {candidates.length === 0 ? (
            <p className="hint">You have no other chats to forward to yet.</p>
          ) : (
            candidates.map((chat) => {
              const on = picked.includes(chat.id);
              return (
                <button
                  key={chat.id}
                  type="button"
                  className="pick-row"
                  onClick={() =>
                    setPicked((prev) => (on ? prev.filter((id) => id !== chat.id) : [...prev, chat.id]))
                  }
                >
                  <Avatar name={chat.title} src={chat.avatar} size={44} />
                  <span className="body">
                    <b>{chat.title}</b>
                    <span>
                      {chat.type === 'group' ? `Group · ${chat.members.length} members` : 'Direct chat'}
                    </span>
                  </span>
                  <span className={`check${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!picked.length}
            onClick={() => onForward(picked)}
          >
            <IconForward size={16} /> Forward
          </button>
        </div>
      </div>
    </div>
  );
}

export function MediaGallery({ convId }: { convId: string }) {
  const [items, setItems] = useState<{ url: string; at: number }[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ messages: { type: string; mediaUrl?: string; at: number }[] }>(
      `/api/chats/${convId}/messages?limit=120`
    )
      .then((res) => {
        if (!alive) return;
        setItems(
          res.messages
            .filter((m) => m.type === 'image' && m.mediaUrl)
            .map((m) => ({ url: m.mediaUrl as string, at: m.at }))
            .slice(-24)
            .reverse()
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [convId]);

  if (!items.length) {
    return <p className="hint">No shared photos yet.</p>;
  }

  return (
    <>
      <div className="gallery">
        {items.map((item) => (
          <button key={item.url} type="button" onClick={() => setOpen(item.url)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt="Shared photo" loading="lazy" />
          </button>
        ))}
      </div>
      {open ? (
        <div className="overlay" onClick={() => setOpen(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open} alt="Shared photo" style={{ maxWidth: '92vw', maxHeight: '88dvh', borderRadius: 10 }} />
        </div>
      ) : null}
    </>
  );
}

export function TypeIcon({ type }: { type: string }) {
  if (type === 'image') return <IconImage size={16} />;
  if (type === 'audio') return <IconMic size={16} />;
  if (type === 'file') return <IconDoc size={16} />;
  return null;
}
