'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, uploadImage } from '@/lib/client';
import type { PublicUser, StatusAuthor } from '@/lib/types';
import { relativeTime, shortPreview } from '@/lib/format';
import { Avatar } from './avatar';
import { StatusViewer } from './status-viewer';
import { IconBack, IconCamera, IconChat, IconClose, IconImage, IconSend } from './icons';

/** The composer's dark backgrounds. The chosen one is stored on the update, so it keeps it. */
const SWATCHES = ['#1f3b4d', '#3b2a4d', '#4d2230', '#14453a', '#4a3a16', '#25303f'];

type Draft = { mode: 'choose' } | { mode: 'text' } | { mode: 'photo'; url: string };

/**
 * The Updates tab: your own status row, then everyone else's, split into what you have not
 * watched yet and what you have. Composing and viewing are full-screen and live in here too,
 * so the screen is the whole feature.
 */
export function UpdatesScreen({
  me,
  onBack,
  onToast,
}: {
  me: PublicUser;
  /** Back to chats. Only shown on wide screens — there the tab bar is hidden, so without it
      a phone that rotated to landscape would be stuck on this screen. */
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [feed, setFeed] = useState<StatusAuthor[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [bg, setBg] = useState(SWATCHES[0]);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<{ author: StatusAuthor; own: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ feed: StatusAuthor[] }>('/api/status');
      setFeed(res.feed);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not load updates');
    } finally {
      setReady(true);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  /* Someone else's new update is only worth noticing while this screen is open: the tab
     unmounts it when you are on Chats, so the timer costs nothing the rest of the time. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  const mine = feed.find((author) => author.user.id === me.id) ?? null;
  const others = feed.filter((author) => author.user.id !== me.id);
  const recent = others.filter((author) => author.items.some((item) => !item.seen));
  const viewed = others.filter((author) => author.items.every((item) => item.seen));

  const latest = mine ? mine.items[mine.items.length - 1] : null;
  const viewTotal = mine
    ? mine.items.reduce((total, item) => total + item.viewCount, 0)
    : 0;

  const openAuthor = useCallback((author: StatusAuthor, own: boolean) => {
    // Opening an author's updates clears their ring straight away; the server catches up as
    // the viewer walks the items and reports each one as seen. Your own are never "unseen".
    const items = own ? author.items : author.items.map((item) => ({ ...item, seen: true }));
    setFeed((prev) =>
      prev.map((group) => (group.user.id === author.user.id ? { ...group, items } : group))
    );
    setDraft(null);
    setViewing({ author: { ...author, items }, own });
  }, []);

  const closeViewer = useCallback(() => {
    setViewing(null);
    // Who watched is only known to the server, and the feed carries the counts.
    load();
  }, [load]);

  const publish = useCallback(
    async (body: Record<string, unknown>) => {
      setSending(true);
      try {
        await post('/api/status', body);
        setDraft(null);
        setText('');
        setCaption('');
        setBg(SWATCHES[0]);
        await load();
        onToast('Update posted');
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not post your update');
      } finally {
        setSending(false);
      }
    },
    [load, onToast]
  );

  const pickPhoto = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        // The same upload path the composer uses, so a photo update is compressed and stored
        // exactly like a photo message.
        const up = await uploadImage(file);
        setDraft({ mode: 'photo', url: up.url });
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not upload that photo');
      } finally {
        setUploading(false);
      }
    },
    [onToast]
  );

  function renderAuthor(author: StatusAuthor, unseen: boolean) {
    const newest = author.items[author.items.length - 1];
    return (
      <button
        key={author.user.id}
        type="button"
        className="updates-row"
        onClick={() => openAuthor(author, false)}
      >
        <Avatar
          name={author.user.displayName}
          src={author.user.avatar}
          size={49}
          ring={unseen}
        />
        <span className="body">
          <b>{author.user.displayName}</b>
          <span>{relativeTime(newest.createdAt)}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="updates">
      <div className="updates-head">
        <button type="button" className="updates-back" onClick={onBack} title="Back to chats">
          <IconBack size={22} />
        </button>
        <h2>Updates</h2>
      </div>

      <div className="updates-body">
        <div className="updates-my">
          <button
            type="button"
            className="updates-row"
            onClick={() => (mine ? openAuthor(mine, true) : setDraft({ mode: 'choose' }))}
          >
            <span className={`updates-thumb${latest ? ' filled' : ''}`}>
              {latest?.kind === 'image' && latest.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latest.mediaUrl} alt="Your latest update" />
              ) : latest?.kind === 'text' ? (
                <span
                  className="updates-thumb-text"
                  style={{ background: latest.bg || SWATCHES[0] }}
                >
                  {shortPreview(latest.text ?? '', 40)}
                </span>
              ) : (
                <Avatar name={me.displayName} src={me.avatar} size={49} />
              )}
              {latest ? null : <span className="updates-plus">+</span>}
            </span>
            <span className="body">
              <b>My status</b>
              <span>
                {latest
                  ? `${relativeTime(latest.createdAt)} · ${viewTotal} ${
                      viewTotal === 1 ? 'view' : 'views'
                    }`
                  : 'Tap to add status update'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Add status update"
            onClick={() => setDraft({ mode: 'choose' })}
          >
            <IconCamera size={19} />
          </button>
        </div>

        {!ready ? (
          <div className="loading">Loading updates…</div>
        ) : others.length === 0 ? (
          <p className="hint" style={{ padding: '18px 16px' }}>
            No updates from other people yet. Updates you post stay visible for 24 hours, and so
            do theirs.
          </p>
        ) : (
          <>
            {recent.length ? (
              <>
                <div className="list-label">Recent updates</div>
                {recent.map((author) => renderAuthor(author, true))}
              </>
            ) : null}
            {viewed.length ? (
              <>
                <div className="list-label">Viewed updates</div>
                {viewed.map((author) => renderAuthor(author, false))}
              </>
            ) : null}
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) pickPhoto(file);
        }}
      />

      {draft && draft.mode === 'choose' ? (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}
        >
          <div className="sheet">
            <div className="sheet-head">
              <h3>Add status update</h3>
              <button
                type="button"
                className="header-btn"
                title="Close"
                onClick={() => setDraft(null)}
              >
                <IconClose />
              </button>
            </div>
            <div className="sheet-body">
              <button
                type="button"
                className="pick-row"
                disabled={uploading}
                onClick={() => setDraft({ mode: 'text' })}
              >
                <span
                  className="ic"
                  style={{ display: 'inline-flex', width: 26, color: 'var(--brand)' }}
                >
                  <IconChat size={20} />
                </span>
                <span className="body">
                  <b>Text</b>
                  <span>Write a few words on a coloured background</span>
                </span>
              </button>
              <button
                type="button"
                className="pick-row"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <span
                  className="ic"
                  style={{ display: 'inline-flex', width: 26, color: 'var(--brand)' }}
                >
                  <IconImage size={20} />
                </span>
                <span className="body">
                  <b>{uploading ? 'Uploading…' : 'Photo'}</b>
                  <span>Share a picture with an optional caption</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draft && draft.mode === 'text' ? (
        <div className="status-compose" style={{ background: bg }}>
          <div className="sc-head">
            <button
              type="button"
              className="header-btn"
              title="Close"
              onClick={() => setDraft(null)}
            >
              <IconClose />
            </button>
            <div className="sc-swatches">
              {SWATCHES.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  className={`sc-swatch${colour === bg ? ' on' : ''}`}
                  style={{ background: colour }}
                  title="Background colour"
                  onClick={() => setBg(colour)}
                />
              ))}
            </div>
            <button
              type="button"
              className="header-btn"
              title="Post update"
              disabled={!text.trim() || sending}
              onClick={() => publish({ kind: 'text', text: text.trim(), bg })}
            >
              <IconSend size={20} />
            </button>
          </div>
          <textarea
            className="sc-text"
            autoFocus
            value={text}
            maxLength={700}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a status"
          />
          <div className="sc-count">{text.length}/700</div>
        </div>
      ) : null}

      {draft && draft.mode === 'photo' ? (
        <div className="status-compose photo">
          <div className="sc-head">
            <button
              type="button"
              className="header-btn"
              title="Back"
              onClick={() => setDraft({ mode: 'choose' })}
            >
              <IconClose />
            </button>
            <span className="sc-title">Photo update</span>
            <button
              type="button"
              className="header-btn"
              title="Post update"
              disabled={sending}
              onClick={() =>
                publish({ kind: 'image', text: caption.trim(), mediaUrl: draft.url })
              }
            >
              <IconSend size={20} />
            </button>
          </div>
          <div className="sc-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.url} alt="Your update" />
          </div>
          <div className="sc-caption">
            <input
              value={caption}
              maxLength={700}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption"
            />
          </div>
        </div>
      ) : null}

      {viewing ? (
        <StatusViewer
          author={viewing.author}
          own={viewing.own}
          onClose={closeViewer}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}
