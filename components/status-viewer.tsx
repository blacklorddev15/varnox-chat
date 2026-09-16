'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, del, post } from '@/lib/client';
import type { StatusAuthor, StatusViewer as Viewer } from '@/lib/types';
import { relativeTime } from '@/lib/format';
import { Avatar } from './avatar';
import { IconClose, IconTrash } from './icons';

/** How long one update is shown before the viewer advances on its own. */
const ITEM_MS = 5000;

/**
 * Full-screen viewer for one author's updates.
 *
 * The same component serves both cases: someone else's updates (each item is marked seen once,
 * so the ring clears for whoever opened it) and your own (where nothing is marked seen and the
 * sheet at the bottom lists who watched instead, plus a delete control).
 */
export function StatusViewer({
  author,
  own,
  onClose,
  onToast,
}: {
  author: StatusAuthor;
  own: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const items = author.items;

  // Opening someone else's updates starts at their first unviewed one, the way a chat list
  // would take you to the unread message.
  const [index, setIndex] = useState(() => {
    if (own) return 0;
    const firstUnseen = items.findIndex((item) => !item.seen);
    return firstUnseen >= 0 ? firstUnseen : 0;
  });
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [dragY, setDragY] = useState(0);
  /** Bumped to restart the clock on the same item when the left half is tapped first. */
  const [tick, setTick] = useState(0);

  // One request per item, however many times the viewer walks back over it.
  const claimed = useRef<Set<string>>(new Set());
  const fired = useRef(false);
  const touchStart = useRef<number | null>(null);

  const item = items[index];

  const goTo = useCallback(
    (next: number) => {
      // Past the last item the viewer is done: closing is what "next" means there.
      if (next >= items.length) {
        onClose();
        return;
      }
      // Before the first item replays that item from the top rather than leaving the viewer.
      if (next < 0) {
        setProgress(0);
        setTick((t) => t + 1);
        return;
      }
      setIndex(next);
    },
    [items.length, onClose]
  );

  /* Auto-advance: one clock per item, restarted whenever the item changes. */
  useEffect(() => {
    if (paused || !item) return;
    fired.current = false;
    setProgress(0);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= ITEM_MS) {
        // The tick that fires may repeat before this effect is cleaned up; advance once.
        if (fired.current) return;
        fired.current = true;
        goTo(index + 1);
      } else {
        setProgress(elapsed / ITEM_MS);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [index, paused, tick, item, goTo]);

  /* Mark the displayed item seen — once per item, and never your own. */
  useEffect(() => {
    if (own || !item || claimed.current.has(item.id)) return;
    claimed.current.add(item.id);
    post(`/api/status/${item.id}/view`).catch(() => undefined);
  }, [own, item]);

  /* Who watched it: only ever asked for your own updates. */
  useEffect(() => {
    if (!own || !item) return;
    let alive = true;
    api<{ viewers: Viewer[] }>(`/api/status/${item.id}/views`)
      .then((res) => {
        if (alive) setViewers(res.viewers);
      })
      .catch(() => {
        if (alive) setViewers([]);
      });
    return () => {
      alive = false;
    };
  }, [own, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose]);

  const remove = useCallback(async () => {
    if (!item) return;
    try {
      await del(`/api/status/${item.id}`);
      onToast('Update deleted');
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not delete that update');
    }
  }, [item, onClose, onToast]);

  if (!item) return null;

  return (
    <div
      className="status-viewer"
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (touchStart.current === null) return;
        const dy = e.touches[0].clientY - touchStart.current;
        if (dy > 0) {
          setDragY(dy);
          setPaused(true);
        }
      }}
      onTouchEnd={() => {
        const dy = dragY;
        touchStart.current = null;
        setDragY(0);
        setPaused(false);
        if (dy > 90) onClose();
      }}
    >
      <div className="sv-bars">
        {items.map((it, i) => (
          <span key={it.id} className="sv-bar">
            <span
              className="sv-bar-fill"
              style={{ width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%' }}
            />
          </span>
        ))}
      </div>

      <div className="sv-head">
        <Avatar name={author.user.displayName} src={author.user.avatar} size={38} />
        <span className="sv-who">
          <b>{author.user.displayName}</b>
          <span>{relativeTime(item.createdAt)}</span>
        </span>
        {own ? (
          <button type="button" className="header-btn" title="Delete update" onClick={remove}>
            <IconTrash size={20} />
          </button>
        ) : null}
        <button type="button" className="header-btn" title="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      <div
        className={`sv-stage${item.kind === 'image' ? ' photo' : ''}`}
        style={item.kind === 'text' ? { background: item.bg || '#1f3b4d' } : undefined}
      >
        {item.kind === 'image' && item.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sv-image" src={item.mediaUrl} alt="Update" />
        ) : (
          <p className="sv-text">{item.text}</p>
        )}
        {item.kind === 'image' && item.text ? <p className="sv-caption">{item.text}</p> : null}
      </div>

      {/* Tapping the right half moves forward, the left half back — the familiar gesture. */}
      <button
        type="button"
        className="sv-hit left"
        aria-label="Previous update"
        onClick={() => goTo(index - 1)}
      />
      <button
        type="button"
        className="sv-hit right"
        aria-label="Next update"
        onClick={() => goTo(index + 1)}
      />

      {own ? (
        <div className="sv-views">
          <div className="sv-views-head">
            <b>{viewers.length}</b>
            <span>{viewers.length === 1 ? 'view' : 'views'}</span>
          </div>
          {viewers.length === 0 ? (
            <p className="hint">Nobody has watched this update yet.</p>
          ) : (
            viewers.map((viewer) => (
              <div className="sv-viewer" key={viewer.user.id}>
                <Avatar name={viewer.user.displayName} src={viewer.user.avatar} size={34} />
                <span className="body">
                  <b>{viewer.user.displayName}</b>
                  <span>{relativeTime(viewer.viewedAt)}</span>
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
