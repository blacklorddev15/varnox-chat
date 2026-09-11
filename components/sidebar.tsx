'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRow, PublicUser, UserSettings } from '@/lib/types';
import { listStamp, shortPreview } from '@/lib/format';
import { Avatar } from './avatar';
import {
  IconArchive,
  IconBellOff,
  IconCheck,
  IconDoc,
  IconDoubleCheck,
  IconExit,
  IconGroup,
  IconImage,
  IconLogo,
  IconMenu,
  IconMic,
  IconMoon,
  IconNewChat,
  IconPin,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
} from './icons';

export function Sidebar({
  me,
  settings,
  chats,
  archived,
  ready,
  selectedId,
  filter,
  onFilter,
  onSelectChat,
  onNewChat,
  onNewGroup,
  onProfile,
  onSettings,
  onStarred,
  onSearch,
  onJoinByCode,
  onToggleTheme,
  onSignOut,
  onToggleArchive,
}: {
  me: PublicUser;
  settings: UserSettings;
  chats: ChatRow[];
  archived: ChatRow[];
  ready: boolean;
  selectedId: string | null;
  filter: 'all' | 'unread' | 'groups';
  onFilter: (f: 'all' | 'unread' | 'groups') => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onStarred: () => void;
  onSearch: () => void;
  onJoinByCode: (code: string) => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onToggleArchive: (chatId: string, on: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [isLight, setIsLight] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsLight(document.documentElement.getAttribute('data-theme') === 'light');
  }, [settings.wallpaper]);

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
        c.memberProfiles.some((p) => p.displayName.toLowerCase().includes(q)) ||
        (c.last?.text ?? '').toLowerCase().includes(q)
    );
  }, [chats, query]);

  function previewIcon(chat: ChatRow) {
    if (chat.last?.type === 'image') return <IconImage size={15} />;
    if (chat.last?.type === 'audio') return <IconMic size={15} />;
    if (chat.last?.type === 'file') return <IconDoc size={15} />;
    return null;
  }

  function renderItem(chat: ChatRow) {
    const pref = settings.chatPrefs[chat.id] ?? {};
    return (
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
          online={chat.type === 'direct' && (chat.peer?.lastSeen ?? 0) > Date.now() - 70_000}
        />
        <span className="chat-item-body">
          <span className="chat-item-top">
            <span className="chat-item-name">
              {chat.title}
              {chat.type === 'group' ? <IconGroup size={14} className="mini-icon" /> : null}
            </span>
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
              {previewIcon(chat)}
              {chat.last ? shortPreview(chat.last.text) : 'No messages yet'}
            </span>
            {pref.muted ? <IconBellOff size={15} className="mini-icon" /> : null}
            {chat.unread > 0 ? (
              <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span>
            ) : null}
          </span>
        </span>
      </button>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button type="button" onClick={onProfile} title="Your profile" style={{ display: 'flex' }}>
          <Avatar name={me.displayName} src={me.avatar} size={40} />
        </button>
        <div className="brand">
          <IconLogo size={23} />
          <span className="brand-name">Varnox</span>
        </div>
        <button type="button" className="header-btn" title="New group" onClick={onNewGroup}>
          <IconGroup size={21} />
        </button>
        <button type="button" className="header-btn" title="New chat" onClick={onNewChat}>
          <IconNewChat size={21} />
        </button>
        <button type="button" className="header-btn" title="Theme" onClick={onToggleTheme}>
          {isLight ? <IconMoon size={20} /> : <IconSun size={20} />}
        </button>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button type="button" className="header-btn" title="Menu" onClick={() => setMenuOpen((v) => !v)}>
            <IconMenu size={20} />
          </button>
          {menuOpen ? (
            <div className="menu">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNewGroup();
                }}
              >
                <IconGroup size={18} /> New group
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onStarred();
                }}
              >
                <IconStar size={18} /> Starred messages
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSearch();
                }}
              >
                <IconSearch size={18} /> Search messages
              </button>
              <button
                type="button"
                onClick={() => {
                  const code = window.prompt('Paste a group invite code or link:');
                  if (code) onJoinByCode(code.trim().split('/').pop() ?? code.trim());
                  setMenuOpen(false);
                }}
              >
                <IconPin size={18} /> Join with invite code
              </button>
              <div className="sep" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSettings();
                }}
              >
                <IconSettings size={18} /> Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onProfile();
                }}
              >
                <Avatar name={me.displayName} src={me.avatar} size={20} /> My profile
              </button>
              <div className="sep" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
              >
                <IconExit size={18} /> Sign out
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
            placeholder="Search"
            aria-label="Search chats"
          />
        </div>
      </div>

      <div className="filter-row">
        {(['all', 'unread', 'groups'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-chip${filter === f ? ' on' : ''}`}
            onClick={() => onFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Groups'}
          </button>
        ))}
      </div>

      <div className="chat-list">
        {!ready ? (
          <div className="loading">Loading your chats…</div>
        ) : filtered.length === 0 ? (
          <div className="loading" style={{ flexDirection: 'column', gap: 10, padding: 28 }}>
            <span>
              {chats.length === 0
                ? 'No chats yet'
                : filter === 'unread'
                  ? 'Nothing unread'
                  : 'No chats match that search'}
            </span>
            {chats.length === 0 ? (
              <button type="button" className="btn" onClick={onNewChat}>
                Start a chat
              </button>
            ) : null}
          </div>
        ) : (
          filtered.map(renderItem)
        )}

        {archived.length ? (
          <>
            <button
              type="button"
              className="settings-row"
              style={{ paddingTop: 12, paddingBottom: 12 }}
              onClick={() => setShowArchived((v) => !v)}
            >
              <span className="ic">
                <IconArchive size={19} />
              </span>
              <span className="txt">
                Archived
                <small>{archived.length} chat{archived.length === 1 ? '' : 's'}</small>
              </span>
            </button>
            {showArchived
              ? archived.map((chat) => (
                  <div key={chat.id} style={{ position: 'relative' }}>
                    {renderItem(chat)}
                    <button
                      type="button"
                      className="icon-btn"
                      title="Unarchive"
                      style={{ position: 'absolute', right: 10, top: 12 }}
                      onClick={() => onToggleArchive(chat.id, false)}
                    >
                      <IconArchive size={17} />
                    </button>
                  </div>
                ))
              : null}
          </>
        ) : null}
      </div>

      <button type="button" className="fab" onClick={onNewChat} title="New chat">
        <IconNewChat size={24} />
      </button>
    </aside>
  );
}
