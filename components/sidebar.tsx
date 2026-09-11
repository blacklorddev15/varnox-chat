'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRow, PublicUser } from '@/lib/types';
import { listStamp, shortPreview } from '@/lib/format';
import { Avatar } from './avatar';
import {
  IconCheck,
  IconChat,
  IconDoubleCheck,
  IconGroup,
  IconLogo,
  IconMenu,
  IconMoon,
  IconNewChat,
  IconSearch,
  IconSun,
} from './icons';

export function Sidebar({
  me,
  chats,
  ready,
  selectedId,
  theme,
  onToggleTheme,
  onSelectChat,
  onNewChat,
  onNewGroup,
  onProfile,
  onSignOut,
}: {
  me: PublicUser;
  chats: ChatRow[];
  ready: boolean;
  selectedId: string | null;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.memberProfiles.some((p) => p.displayName.toLowerCase().includes(q))
    );
  }, [chats, query]);

  const totalUnread = chats.reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          onClick={onProfile}
          title="Your profile"
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <Avatar name={me.displayName} src={me.avatar} size={40} />
        </button>
        <div className="brand">
          <IconLogo size={24} />
          <span className="brand-name">Varnox</span>
        </div>
        <button type="button" className="icon-btn" title="New group" onClick={onNewGroup}>
          <IconGroup />
        </button>
        <button type="button" className="icon-btn" title="New chat" onClick={onNewChat}>
          <IconNewChat />
        </button>
        <button type="button" className="icon-btn" title="Theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            type="button"
            className="icon-btn"
            title="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconMenu />
          </button>
          {menuOpen ? (
            <div className="menu">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onProfile();
                }}
              >
                <Avatar name={me.displayName} src={me.avatar} size={22} />
                My profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleTheme();
                }}
              >
                {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                {theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </button>
              <div className="sep" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
              >
                <IconChat size={18} />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="search-row">
        <div className="search-box">
          <IconSearch size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </div>
      </div>

      <div className="chat-list">
        {!ready ? (
          <div className="loading">Loading your chats…</div>
        ) : filtered.length === 0 ? (
          <div className="loading" style={{ flexDirection: 'column', gap: 8, padding: 26 }}>
            <span>{chats.length === 0 ? 'No chats yet' : 'No chats match that search'}</span>
            {chats.length === 0 ? (
              <button type="button" className="btn" onClick={onNewChat}>
                Start a chat
              </button>
            ) : null}
          </div>
        ) : (
          filtered.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className={`chat-item${chat.id === selectedId ? ' active' : ''}`}
              onClick={() => onSelectChat(chat.id)}
            >
              <Avatar
                name={chat.title}
                src={chat.avatar}
                size={49}
                online={chat.type === 'direct' && (chat.peer?.lastSeen ?? 0) > Date.now() - 60_000}
              />
              <span className="chat-item-body">
                <span className="chat-item-top">
                  <span className="chat-item-name">{chat.title}</span>
                  <span className={`chat-item-time${chat.unread > 0 ? ' unread' : ''}`}>
                    {chat.updatedAt ? listStamp(chat.updatedAt) : ''}
                  </span>
                </span>
                <span className="chat-item-bottom">
                  <span className="chat-item-preview">
                    {chat.last?.senderId === me.id ? (
                      <span className="tick" style={{ flex: 'none' }}>
                        {chat.readAt >= (chat.last?.at ?? 0) ? (
                          <IconDoubleCheck size={15} className="tick read" />
                        ) : (
                          <IconCheck size={15} />
                        )}
                      </span>
                    ) : null}
                    {chat.last?.type === 'image' ? 'Photo' : shortPreview(chat.last?.text ?? '')}
                    {!chat.last ? 'No messages yet' : ''}
                  </span>
                  {chat.unread > 0 ? <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span> : null}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {totalUnread > 0 ? (
        <div className="hint" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)' }}>
          {totalUnread} unread {totalUnread === 1 ? 'chat' : 'chats'}
        </div>
      ) : null}
    </aside>
  );
}
