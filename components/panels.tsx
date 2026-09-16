'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, post, uploadImage } from '@/lib/client';
import type { ChatRow, PublicUser } from '@/lib/types';
import { presence } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { Avatar } from './avatar';
import { MediaGallery } from './overlays';
import { IconCheck, IconClock, IconClose, IconLink, IconSearch } from './icons';

function Sheet({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
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
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Who to show for a person: their formatted phone, else their handle. */
function label(user: { phone?: string | null; username: string }): string {
  return formatPhone(user.phone ?? null) || `@${user.username}`;
}

function useUserSearch(query: string) {
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    let alive = true;
    setSearching(true);
    // An empty query fetches the directory rather than clearing the list: a new account has
    // no chats, so the panel would otherwise open empty and look broken.
    const timer = window.setTimeout(
      async () => {
        try {
          const path = q.length < 1 ? '/api/users' : `/api/users?q=${encodeURIComponent(q)}`;
          const res = await api<{ users: PublicUser[] }>(path);
          if (alive) setResults(res.users);
        } catch {
          if (alive) setResults([]);
        } finally {
          if (alive) setSearching(false);
        }
      },
      q.length < 1 ? 0 : 220
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  return { results, searching };
}

export function NewChatPanel({
  me,
  onClose,
  onPick,
}: {
  me: PublicUser;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, searching } = useUserSearch(query);

  return (
    <Sheet title="New chat" onClose={onClose}>
      <div className="search-box" style={{ marginBottom: 12 }}>
        <IconSearch size={18} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone or username"
        />
      </div>

      {!query.trim() && results.length > 0 ? (
        <p className="hint" style={{ marginBottom: 8 }}>
          People on Varnox
        </p>
      ) : null}

      {results.length === 0 ? (
        <p className="hint">
          {query.trim() ? (
            searching ? 'Searching…' : `No one found for “${query.trim()}”.`
          ) : searching ? (
            'Loading…'
          ) : (
            <>
              Nobody else has signed up yet. You are signed in as <b>{label(me)}</b>.
            </>
          )}
        </p>
      ) : (
        results.map((user) => (
          <button key={user.id} type="button" className="pick-row" onClick={() => onPick(user.id)}>
            <Avatar name={user.displayName} src={user.avatar} size={44} />
            <span className="body">
              <b>{user.displayName}</b>
              <span>
                {label(user)} · {presence(user.lastSeen)}
              </span>
            </span>
          </button>
        ))
      )}
    </Sheet>
  );
}

export function NewGroupPanel({
  me,
  onClose,
  onCreate,
}: {
  me: PublicUser;
  onClose: () => void;
  onCreate: (name: string, memberIds: string[]) => void;
}) {
  const [name, setName] = useState('New group');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const { results } = useUserSearch(query);

  function toggle(user: PublicUser) {
    setPicked((prev) =>
      prev.some((p) => p.id === user.id) ? prev.filter((p) => p.id !== user.id) : [...prev, user]
    );
  }

  return (
    <Sheet
      title="New group"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim(), picked.map((p) => p.id))}
          >
            {picked.length === 0
              ? 'Create group on my own'
              : `Create group with ${picked.length + 1} members`}
          </button>
        </>
      }
    >
      <div className="field-row">
        <label htmlFor="group-name">Group name</label>
        <input
          id="group-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekend plans"
        />
      </div>

      {picked.length ? (
        <div className="chips">
          {picked.map((p) => (
            <span key={p.id} className="chip">
              <Avatar name={p.displayName} src={p.avatar} size={22} />
              {p.displayName}
              <button type="button" onClick={() => toggle(p)} title="Remove">
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="search-box" style={{ margin: '10px 0' }}>
        <IconSearch size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add members by phone number"
          inputMode="tel"
        />
      </div>

      {query.trim() && results.length === 0 ? (
        <p className="hint">No one found for “{query.trim()}”.</p>
      ) : null}

      {results.map((user) => {
        const on = picked.some((p) => p.id === user.id);
        return (
          <button key={user.id} type="button" className="pick-row" onClick={() => toggle(user)}>
            <Avatar name={user.displayName} src={user.avatar} size={44} />
            <span className="body">
              <b>{user.displayName}</b>
              <span>{label(user)}</span>
            </span>
            <span className={`check${on ? ' on' : ''}`}>{on ? <IconCheck size={13} /> : null}</span>
          </button>
        );
      })}

      {!query.trim() ? (
        <p className="hint" style={{ marginTop: 8 }}>
          You can create the group now with nobody else in it, then add people later — by their
          phone number from Group info, or by sharing the invite link so they join themselves. You
          are signed in as <b>{label(me)}</b> and become the group admin.
        </p>
      ) : null}
    </Sheet>
  );
}

export function ProfilePanel({
  me,
  onClose,
  onSave,
}: {
  me: PublicUser;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [about, setAbout] = useState(me.about);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(me.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function pickPhoto(file: File) {
    setBusy(true);
    setError('');
    try {
      const res = await uploadImage(file);
      setAvatar(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="My profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onSave({ displayName, about, avatar, phone })}
          >
            Save
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <button type="button" onClick={() => fileRef.current?.click()} title="Change photo">
          <Avatar name={displayName} src={avatar} size={74} />
        </button>
        <div>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Change photo'}
          </button>
          {avatar ? (
            <button
              type="button"
              className="btn ghost"
              style={{ marginLeft: 8 }}
              onClick={() => setAvatar(null)}
            >
              Remove
            </button>
          ) : null}
          <div className="hint" style={{ marginTop: 6 }}>
            {formatPhone(me.phone) || `@${me.username}`}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickPhoto(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="field-row">
        <label htmlFor="display">Your name</label>
        <input
          id="display"
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
        />
      </div>

      <div className="field-row">
        <label htmlFor="phone">Phone number (your login)</label>
        <input
          id="phone"
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+65 9123 4567"
          inputMode="tel"
          autoComplete="tel"
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Include the country code. This is the number you sign in with and the one other people use
          to find you.
        </p>
      </div>

      <div className="field-row">
        <label htmlFor="about">About</label>
        <input
          id="about"
          className="input"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          maxLength={140}
          placeholder="Hey there! I am using Varnox."
        />
      </div>

      {error ? <p className="error">{error}</p> : null}
    </Sheet>
  );
}

const TIMERS: { sec: number; label: string }[] = [
  { sec: 0, label: 'Off' },
  { sec: 86_400, label: '24 hours' },
  { sec: 604_800, label: '7 days' },
  { sec: 7_776_000, label: '90 days' },
];

export function ChatInfoPanel({
  me,
  chat,
  onClose,
  onUpdate,
  onLeave,
  onBlock,
  blocked,
}: {
  me: PublicUser;
  chat: ChatRow;
  onClose: () => void;
  onUpdate: (chatId: string, body: Record<string, unknown>) => void;
  onLeave: (chatId: string) => void;
  onBlock: (blocked: boolean) => void;
  blocked: boolean;
}) {
  const isGroup = chat.type === 'group';
  const isAdmin = chat.admins.includes(me.id);
  const [name, setName] = useState(chat.title);
  const [query, setQuery] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const { results } = useUserSearch(query);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(chat.title);
    setQuery('');
    setInvite('');
  }, [chat.id, chat.title]);

  const nonMembers = useMemo(
    () => results.filter((u) => !chat.members.includes(u.id)),
    [results, chat.members]
  );

  async function pickPhoto(file: File) {
    setBusy(true);
    try {
      const res = await uploadImage(file);
      onUpdate(chat.id, { avatar: res.url });
    } finally {
      setBusy(false);
    }
  }

  async function makeInvite() {
    setBusy(true);
    try {
      const res = await post<{ path: string }>(`/api/chats/${chat.id}/invite`);
      const url = `${window.location.origin}${res.path}`;
      setInvite(url);
      navigator.clipboard?.writeText(url).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={isGroup ? 'Group info' : 'Contact info'} onClose={onClose}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <button
          type="button"
          onClick={() => (isGroup && isAdmin ? fileRef.current?.click() : undefined)}
        >
          <Avatar name={chat.title} src={chat.avatar} size={96} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 500 }}>{chat.title}</div>
          <div className="hint">
            {isGroup
              ? `Group · ${chat.members.length} member${chat.members.length === 1 ? '' : 's'}`
              : `${chat.peer ? label(chat.peer) : 'unknown'} · ${presence(chat.peer?.lastSeen ?? 0)}`}
          </div>
        </div>
        {isGroup && isAdmin ? (
          <>
            <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
              {busy ? 'Uploading…' : 'Change group photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickPhoto(f);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
      </div>

      {isGroup && isAdmin ? (
        <div className="field-row">
          <label htmlFor="gname">Group name</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="gname"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <button
              type="button"
              className="btn"
              disabled={!name.trim() || name === chat.title}
              onClick={() => onUpdate(chat.id, { name: name.trim() })}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      {isGroup ? (
        <div className="field-row">
          <label>Invite link</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={invite} readOnly placeholder="Create a link to share" />
            <button type="button" className="btn" onClick={makeInvite} disabled={busy}>
              <IconLink size={16} />
            </button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Anyone signed in to this Varnox who opens the link joins the group.
          </p>
        </div>
      ) : null}

      <div className="field-row">
        <label>
          <IconClock size={14} /> Disappearing messages
        </label>
        <div className="seg-row" style={{ padding: 0 }}>
          {TIMERS.map((t) => (
            <button
              key={t.sec}
              type="button"
              className={`seg${(chat.disappearSec ?? 0) === t.sec ? ' on' : ''}`}
              disabled={isGroup && !isAdmin}
              onClick={() => onUpdate(chat.id, { disappearSec: t.sec })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          New messages in this chat disappear for everyone after the chosen time.
        </p>
      </div>

      {isGroup ? (
        <>
          <div className="list-label">
            {chat.members.length} member{chat.members.length === 1 ? '' : 's'}
          </div>
          {chat.memberProfiles.map((p) => (
            <div key={p.id} className="member-row">
              <Avatar name={p.displayName} src={p.avatar} size={42} />
              <span className="body">
                <b>
                  {p.displayName}
                  {p.id === me.id ? ' (you)' : ''}
                </b>
                <span>{label(p)}</span>
              </span>
              {chat.admins.includes(p.id) ? <span className="tag">admin</span> : null}
              {isAdmin && p.id !== me.id ? (
                <button
                  type="button"
                  className="header-btn"
                  title="Remove from group"
                  onClick={() => onUpdate(chat.id, { removeMembers: [p.id] })}
                >
                  <IconClose size={17} />
                </button>
              ) : null}
            </div>
          ))}

          <div className="search-box" style={{ margin: '14px 0 6px' }}>
            <IconSearch size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add someone by phone number"
              inputMode="tel"
            />
          </div>
          {query.trim() && nonMembers.length === 0 ? (
            <p className="hint">No one to add for “{query.trim()}”.</p>
          ) : null}
          {nonMembers.map((u) => (
            <button
              key={u.id}
              type="button"
              className="pick-row"
              onClick={() => {
                onUpdate(chat.id, { addMembers: [u.id] });
                setQuery('');
              }}
            >
              <Avatar name={u.displayName} src={u.avatar} size={42} />
              <span className="body">
                <b>{u.displayName}</b>
                <span>{label(u)}</span>
              </span>
              <span className="tag">Add</span>
            </button>
          ))}
        </>
      ) : (
        <div className="member-row">
          <Avatar
            name={chat.peer?.displayName ?? chat.title}
            src={chat.peer?.avatar ?? null}
            size={42}
          />
          <span className="body">
            <b>{chat.peer?.displayName ?? chat.title}</b>
            <span>{chat.peer ? label(chat.peer) : 'No number on file'}</span>
            <span>{chat.peer?.about || 'No about text'}</span>
          </span>
        </div>
      )}

      <div className="list-label">Shared photos</div>
      <MediaGallery convId={chat.id} />

      <div
        style={{
          marginTop: 20,
          borderTop: '1px solid var(--line)',
          paddingTop: 14,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {!isGroup && chat.peer ? (
          <button
            type="button"
            className={blocked ? 'btn ghost' : 'btn danger'}
            onClick={() => onBlock(!blocked)}
          >
            {blocked ? 'Unblock contact' : 'Block contact'}
          </button>
        ) : null}
        <button type="button" className="btn danger" onClick={() => onLeave(chat.id)}>
          {isGroup ? 'Leave group' : 'Delete chat'}
        </button>
      </div>
    </Sheet>
  );
}
