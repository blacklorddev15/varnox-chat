'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, del, post, uploadImage } from '@/lib/client';
import type { ChatRow, Device, PublicUser, WhatsAppPairing, WhatsAppSession } from '@/lib/types';
import { presence, relativeTime } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { Avatar } from './avatar';
import { MediaGallery } from './overlays';
import { IconBack, IconCheck, IconClock, IconClose, IconLink, IconSearch } from './icons';

export function Sheet({
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

/**
 * The same screen as a Sheet, but living in the chat column instead of over everything.
 *
 * A destination reached from the menu is a page, and a page that covers the sidebar and the
 * chat list with a backdrop is not what a page looks like — it is a dialog. This fills the
 * column the chat pane would have used, so the sidebar stays where it is and the way back is
 * a control in the header rather than a tap on the backdrop.
 *
 * The API mirrors Sheet's on purpose: the panel internals do not know or care which one is
 * wrapping them, so moving one between the two is a one-line change.
 */
export function PaneScreen({
  title,
  children,
  onBack,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  onBack: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="pane">
      <div className="pane-head">
        <button type="button" className="header-btn" onClick={onBack} title="Back">
          <IconBack size={20} />
        </button>
        <h3>{title}</h3>
      </div>
      <div className="pane-body">{children}</div>
      {footer ? <div className="pane-foot">{footer}</div> : null}
    </div>
  );
}

/** Who to show for a person: their formatted phone, else their handle. */
function label(user: { phone?: string | null; username: string }): string {
  return formatPhone(user.phone ?? null) || `@${user.username}`;
}

/**
 * The directory search the new-chat and new-group panels share. Exported so the new-call panel
 * can show exactly the same list — a call picks a person from the same place a chat does.
 */
export function useUserSearch(query: string) {
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
  onBack,
  onCreate,
}: {
  me: PublicUser;
  onBack: () => void;
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
    <PaneScreen
      title="New group"
      onBack={onBack}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onBack}>
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
    </PaneScreen>
  );
}

export function ProfilePanel({
  me,
  onBack,
  onSave,
}: {
  me: PublicUser;
  onBack: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [about, setAbout] = useState(me.about);
  const [phone, setPhone] = useState(me.phone ?? '');
  // An account made from a phone number and a password has no address until it is added
  // here — it is optional, but it is the only way back in if the number is lost.
  const [email, setEmail] = useState(me.email ?? '');
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
    <PaneScreen
      title="My profile"
      onBack={onBack}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onBack}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onSave({ displayName, about, avatar, phone, email })}
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
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          inputMode="email"
          autoComplete="email"
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Optional, and never shown to anyone else. It is how you sign in and how you get back into
          the account if you lose the number. Clear it to remove it.
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
    </PaneScreen>
  );
}

/** What to call a device: its label, else a trimmed user agent, else nothing useful. */
function deviceName(device: Device): string {
  const name = device.label || device.userAgent || '';
  if (!name) return 'Unknown device';
  return name.length > 56 ? `${name.slice(0, 55)}…` : name;
}

/**
 * The devices signed in to this account, and the way to add another one.
 *
 * No code is created until the button is pressed: a code is good for two minutes and is the
 * credential the other device presents, so one should not be sitting on screen (or in the
 * database) just because this panel was opened.
 */
export function LinkedDevicesPanel({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api<{ devices: Device[] }>('/api/link/devices');
      setDevices(res.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One tick a second while a code is on screen, counting down the seconds the server said
  // it has left rather than a local deadline.
  useEffect(() => {
    if (seconds <= 0) return;
    const id = window.setInterval(() => setSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [seconds]);

  async function linkDevice() {
    setBusy(true);
    setError('');
    try {
      const res = await post<{ code: string; expiresInSec: number }>('/api/link/code');
      setCode(res.code);
      setSeconds(res.expiresInSec);
    } catch (err) {
      // A throttled request answers with when to come back, which is the useful part.
      setError(err instanceof Error ? err.message : 'Could not create a code');
    } finally {
      setBusy(false);
    }
  }

  async function logOut(device: Device) {
    setBusy(true);
    setError('');
    try {
      await del(`/api/link/devices/${device.id}`);
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that device out');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Linked devices" onClose={onClose}>
      <p className="hint" style={{ marginBottom: 10 }}>
        Every device signed in to this account. Logging one out ends its session there.
      </p>

      {loading ? (
        <div className="loading">Loading your devices…</div>
      ) : devices.length === 0 ? (
        <p className="hint">No devices are signed in yet.</p>
      ) : (
        devices.map((device) => (
          <div key={device.id} className="member-row">
            <span className="body">
              <b>
                {deviceName(device)}
                {device.current ? (
                  <span className="tag" style={{ marginLeft: 8 }}>
                    This device
                  </span>
                ) : null}
              </b>
              <span>{presence(device.lastSeen)}</span>
            </span>
            {device.current ? null : (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void logOut(device)}
              >
                Log out
              </button>
            )}
          </div>
        ))
      )}

      <div className="field-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={linkDevice} disabled={busy}>
          {busy ? 'Getting a code…' : code ? 'Get a new code' : 'Link a device'}
        </button>
      </div>

      {code ? (
        <>
          <div style={{ textAlign: 'center', margin: '6px 0 10px' }}>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: 6 }}>{code}</div>
            <p className="hint">{seconds > 0 ? `Expires in ${seconds}s` : 'That code has expired.'}</p>
          </div>
          <p className="hint">
            Open Varnox on the other device, choose Link a device, and enter this code.
          </p>
        </>
      ) : (
        <p className="hint">
          The code signs the other device in as you, and can only be used once.
        </p>
      )}

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

/**
 * The reasons offered, matching the list the API accepts. Fixed rather than free text so the
 * owner's queue can be counted and skimmed, with "Something else" covering whatever the list
 * forgot. The wording is what a person would say, not internal categories — somebody picks from
 * this while annoyed.
 */
const REPORT_REASONS: [string, string][] = [
  ['spam', 'Spam or unwanted messages'],
  ['scam', 'Scam or fraud'],
  ['harassment', 'Harassment or threats'],
  ['impersonation', 'Pretending to be someone else'],
  ['inappropriate', 'Inappropriate content'],
  ['other', 'Something else'],
];

/**
 * Report this contact or group.
 *
 * Inline inside the info panel rather than in a sheet of its own: the panel is already a sheet,
 * and stacking one on another makes the backdrop ambiguous — a click on it would have to mean
 * one of two different things, and the wrong guess closes the form somebody was filling in.
 *
 * Nothing is sent until a reason is chosen. The api refuses a report with no reason anyway, and
 * a button that only sometimes works is worse than one that is visibly disabled.
 *
 * The confirmation replaces the form instead of appearing beneath it, so nobody has to wonder
 * whether it went.
 */
function ReportBlock({ kind, targetId }: { kind: 'user' | 'group'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function send() {
    if (!reason) return;
    setState('sending');
    try {
      // The server works out the name of what is being reported and ignores anything the client
      // might claim about it, so nothing here is sent for display on the other end.
      await post('/api/reports', { kind, targetId, reason, note: note.trim() });
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  if (state === 'sent') {
    return (
      <p className="hint" style={{ flexBasis: '100%', margin: 0 }}>
        Sent for review. Thank you — a person reads these.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }

  return (
    <div style={{ flexBasis: '100%' }}>
      <div className="list-label">Why are you reporting this?</div>
      {REPORT_REASONS.map(([value, label]) => (
        <button key={value} type="button" className="pick-row" onClick={() => setReason(value)}>
          <span className={`check${reason === value ? ' on' : ''}`}>
            {reason === value ? <IconCheck size={13} /> : null}
          </span>
          <span className="body">{label}</span>
        </button>
      ))}

      <textarea
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything to add? (optional)"
        style={{ width: '100%', marginTop: 10, minHeight: 68 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn"
          disabled={!reason || state === 'sending'}
          onClick={send}
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      {state === 'failed' ? (
        <p className="error">Could not send that. Try again in a moment.</p>
      ) : null}
    </div>
  );
}

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
        {isGroup ? (
          <ReportBlock kind="group" targetId={chat.id} />
        ) : chat.peer ? (
          <ReportBlock kind="user" targetId={chat.peer.id} />
        ) : null}
        <button type="button" className="btn danger" onClick={() => onLeave(chat.id)}>
          {isGroup ? 'Leave group' : 'Delete chat'}
        </button>
      </div>
    </Sheet>
  );
}

/* ── linking a whatsapp number ─────────────────────────────────────────── */

/**
 * The bot's pairing states, said in words the person reading the screen understands. A state
 * this app has not heard of is shown exactly as the bot wrote it rather than mapped to
 * something wrong, so a bot that grows a new step does not blank the screen.
 */
function pairingStatusLabel(status: string): string {
  if (status === 'pending') return 'Waiting for the bot to pick this up…';
  if (status === 'processing') return 'The bot is preparing your code…';
  if (status === 'code_generated') return 'Enter this code in WhatsApp';
  if (status === 'connected') return 'Linked';
  if (status === 'failed') return 'Pairing failed';
  if (status === 'expired') return 'This request expired';
  return status;
}

/** The same, for a linked session — 'disconnected' is what the bot writes once it is gone. */
function sessionStatusLabel(status: string): string {
  if (status === 'connected') return 'Connected';
  if (status === 'disconnected') return 'Disconnected';
  return status || 'Unknown';
}

/**
 * The "Link WhatsApp" sheet.
 *
 * Step one takes a number and asks the external bot for a code. Step two shows what the bot
 * wrote while the screen polls for the transition to 'connected', and the number then moves
 * into the list below. Every string that comes from the bot — the code, an error — is rendered
 * as text, never as markup.
 */
export function WhatsAppLinkPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [pairing, setPairing] = useState<WhatsAppPairing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api<{ sessions: WhatsAppSession[] }>('/api/whatsapp/sessions');
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your linked numbers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pairingId = pairing?.id ?? null;
  const secondsLeft = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const terminal = pairing?.status === 'connected' || pairing?.status === 'failed';
  const expired = Boolean(pairing && (pairing.status === 'expired' || pairing.expiresAt <= now));

  /**
   * One tick a second while the code step is open. It drives the countdown, and every other
   * tick it asks the server what the bot has written.
   *
   * The effect drops out — and so clears its interval — on unmount, on success, on failure and
   * on expiry, because each of those makes one of its conditions false. `now` is deliberately
   * not a dependency: only the boolean `expired` is, so the interval is not torn down and
   * restarted on every second that passes.
   */
  useEffect(() => {
    if (step !== 'code' || pairingId === null || terminal || expired) return;
    let lastPoll = 0;
    const tick = async () => {
      const at = Date.now();
      setNow(at);
      if (at - lastPoll < 2000) return;
      lastPoll = at;
      try {
        const res = await api<{ pairing: WhatsAppPairing }>(`/api/whatsapp/pair/${pairingId}`);
        setPairing(res.pairing);
      } catch {
        // A dropped poll is not a failed pairing: keep the last known state and ask again.
      }
    };
    const id = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(id);
  }, [step, pairingId, terminal, expired]);

  // Reaching 'connected' is the one moment the number moves into the list, and the one moment
  // a fresh status can be shown without racing the next poll.
  useEffect(() => {
    if (pairing?.status !== 'connected') return;
    setNotice(`${formatPhone(pairing.phone) || pairing.phone} is linked.`);
    void load();
  }, [pairing?.status, pairing?.phone, load]);

  function backToPhone() {
    setStep('phone');
    setPairing(null);
    setError('');
  }

  async function requestCode() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await post<{ pairing: WhatsAppPairing }>('/api/whatsapp/pair', { phone });
      setPairing(res.pairing);
      setNow(Date.now());
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start pairing');
    } finally {
      setBusy(false);
    }
  }

  async function forget(session: WhatsAppSession) {
    setBusy(true);
    setError('');
    try {
      await del(`/api/whatsapp/sessions/${encodeURIComponent(session.id)}`);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not forget that number');
    } finally {
      setBusy(false);
    }
  }

  const minutes = String(Math.floor(secondsLeft / 60));
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Sheet title="Link WhatsApp" onClose={onClose}>
      <p className="hint" style={{ marginBottom: 14 }}>
        Linking makes this WhatsApp number answer from the machine running the bot. Use a number
        you are willing to keep for that — it is separate from the number you sign in with here.
      </p>

      {step === 'phone' ? (
        <div className="field-row">
          <label htmlFor="whatsapp-phone">WhatsApp number</label>
          <input
            id="whatsapp-phone"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+65 9123 4567"
            inputMode="tel"
            autoComplete="tel"
          />
          <p className="hint" style={{ marginTop: 6 }}>
            Include the country code. A pairing code will be generated for this number.
          </p>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 10 }}
            disabled={busy || !phone.trim()}
            onClick={() => void requestCode()}
          >
            {busy ? 'Requesting…' : 'Generate pairing code'}
          </button>
        </div>
      ) : (
        <div className="field-row">
          {pairing?.status === 'connected' ? (
            <p className="hint">
              {pairingStatusLabel(pairing.status)}. The number is in your list below.
            </p>
          ) : pairing?.status === 'failed' ? (
            <>
              {/* Whatever the bot wrote is shown as text; it is never rendered as markup. */}
              <p className="error">{pairing.error || 'The bot could not pair that number.'}</p>
              <button type="button" className="btn" style={{ marginTop: 10 }} onClick={backToPhone}>
                Try again
              </button>
            </>
          ) : expired ? (
            <>
              <p className="hint">
                This request expired before it was connected. Ask for a new code.
              </p>
              <button type="button" className="btn" style={{ marginTop: 10 }} onClick={backToPhone}>
                Try again
              </button>
            </>
          ) : pairing?.status === 'code_generated' && pairing.code ? (
            <>
              <div style={{ textAlign: 'center', margin: '2px 0 12px' }}>
                <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: 6 }}>
                  {pairing.code}
                </div>
                <p className="hint">
                  {secondsLeft > 0
                    ? `Expires in ${minutes}:${seconds}`
                    : 'That code has expired.'}
                </p>
              </div>
              <p className="hint">
                Open WhatsApp on your phone, open Linked devices, then choose Link with a phone
                number and enter the code above.
              </p>
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 10 }}
                onClick={backToPhone}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="hint">{pairingStatusLabel(pairing?.status ?? '')}</p>
              <p className="hint">
                {secondsLeft > 0
                  ? `The code is good for five minutes once it arrives. Expires in ${minutes}:${seconds}.`
                  : 'Waiting for the bot…'}
              </p>
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 10 }}
                onClick={backToPhone}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      <div className="list-label" style={{ marginTop: 18 }}>
        Linked numbers
      </div>
      {loading ? (
        <div className="loading">Loading your numbers…</div>
      ) : sessions.length === 0 ? (
        <p className="hint">No WhatsApp numbers are linked yet.</p>
      ) : (
        sessions.map((session) => (
          <div key={session.id} className="member-row">
            <span className="body">
              <b>{formatPhone(session.phone) || session.phone}</b>
              <span>
                {sessionStatusLabel(session.status)}
                {session.updatedAt ? ` · last changed ${relativeTime(session.updatedAt)}` : ''}
              </span>
            </span>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void forget(session)}
            >
              Forget
            </button>
          </div>
        ))
      )}
      <p className="hint" style={{ marginTop: 6 }}>
        Forget removes a number from this list only. It does not log the device out of WhatsApp.
      </p>

      {notice ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {notice}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </Sheet>
  );
}
