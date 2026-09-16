'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, uploadImage } from '@/lib/client';
import type { Channel, ChannelFollower, ChannelPost } from '@/lib/types';
import { relativeTime, shortPreview } from '@/lib/format';
import { Avatar } from './avatar';
import { IconBack, IconCamera, IconClose, IconMenu, IconSend } from './icons';

/** The same ceiling the posts route enforces, so the limit is visible while typing. */
const MAX_TEXT = 1000;

/**
 * One channel, full screen: a header, the posts, and — only for the owner — a composer.
 *
 * A post is drawn as a plain full-width block. Nothing here shows a tick, a reply or a
 * per-recipient status, because a channel is read by everyone at once rather than delivered
 * to anyone in particular.
 *
 * Opening the channel is also what clears its unread dot: the first load marks it read, and a
 * post that arrives while the channel is open moves the mark with it.
 */
export function ChannelView({
  channel: opening,
  onBack,
  onToast,
}: {
  channel: Channel;
  /** Back to the list, which reloads behind this view so the dot and the counts are current. */
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [channel, setChannel] = useState<Channel>(opening);
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [followers, setFollowers] = useState<ChannelFollower[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  /** Newest post already known to this view, so the read mark only moves when it should. */
  const newestSeen = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ channel: Channel; posts: ChannelPost[] }>(
        `/api/channels/${opening.id}`
      );
      setChannel(res.channel);
      setPosts(res.posts);
      const newest = res.posts[res.posts.length - 1]?.id ?? null;
      if (newest && newest !== newestSeen.current) {
        newestSeen.current = newest;
        post(`/api/channels/${opening.id}/read`).catch(() => undefined);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not open that channel');
    } finally {
      setReady(true);
    }
  }, [onToast, opening.id]);

  useEffect(() => {
    load();
  }, [load]);

  /* A broadcast is worth watching while it is open, and the tab unmounts this view the rest
     of the time, so the timer costs nothing when nobody is looking. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  /* Newest post stays in view, the way a conversation does. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [posts.length]);

  const sendText = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await post<{ post: ChannelPost }>(`/api/channels/${channel.id}/posts`, {
        kind: 'text',
        text: body,
      });
      setPosts((prev) => [...prev, res.post]);
      setText('');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not post that');
    } finally {
      setSending(false);
    }
  }, [channel.id, onToast, sending, text]);

  const sendPhoto = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        // The same upload path the composer uses, so a photo post is stored exactly like a
        // photo message. Whatever is in the box when the picture is picked becomes its caption.
        const up = await uploadImage(file);
        const res = await post<{ post: ChannelPost }>(`/api/channels/${channel.id}/posts`, {
          kind: 'image',
          mediaUrl: up.url,
          text: text.trim(),
        });
        setPosts((prev) => [...prev, res.post]);
        setText('');
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not post that photo');
      } finally {
        setUploading(false);
      }
    },
    [channel.id, onToast, text]
  );

  const leave = useCallback(async () => {
    setLeaving(true);
    try {
      await post(`/api/channels/${channel.id}/unfollow`);
      onToast(`You left ${channel.name}`);
      onBack();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not leave that channel');
      setLeaving(false);
      setMenu(false);
    }
  }, [channel.id, channel.name, onBack, onToast]);

  const openFollowers = useCallback(async () => {
    if (followers) {
      setFollowers(null);
      return;
    }
    try {
      const res = await api<{ followers: ChannelFollower[] }>(
        `/api/channels/${channel.id}/followers`
      );
      setFollowers(res.followers);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not load the follower list');
    }
  }, [channel.id, followers, onToast]);

  const count = `${channel.followers} ${channel.followers === 1 ? 'follower' : 'followers'}`;

  return (
    <div className="channel-view">
      <div className="channel-head">
        <button type="button" className="header-btn" title="Back to channels" onClick={onBack}>
          <IconBack size={22} />
        </button>
        <Avatar name={channel.name} src={channel.avatar} size={38} />
        {channel.isOwner ? (
          <button type="button" className="who" title="Who follows" onClick={openFollowers}>
            <b>{channel.name}</b>
            <span>{count} · tap for the list</span>
          </button>
        ) : (
          <span className="who">
            <b>{channel.name}</b>
            <span>{count}</span>
          </span>
        )}
        {channel.following && !channel.isOwner ? (
          <button
            type="button"
            className="header-btn"
            title="Channel options"
            onClick={() => setMenu((v) => !v)}
          >
            <IconMenu size={20} />
          </button>
        ) : null}

        {menu ? (
          <div className="menu">
            <button type="button" disabled={leaving} onClick={leave}>
              <IconClose size={18} />
              Leave channel
            </button>
          </div>
        ) : null}
      </div>

      <div className="channel-body">
        {channel.description ? (
          <p className="ch-about">{shortPreview(channel.description, 240)}</p>
        ) : null}

        {!ready ? (
          <div className="loading">Loading posts…</div>
        ) : posts.length === 0 ? (
          <p className="hint" style={{ padding: '18px 16px' }}>
            {channel.isOwner
              ? 'Nothing here yet. Post something and your followers will see it.'
              : 'Nothing here yet. Posts from this channel will appear here.'}
          </p>
        ) : (
          posts.map((item) => (
            <article className="ch-post" key={item.id}>
              {item.kind === 'image' && item.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.mediaUrl} alt="Channel post" />
              ) : null}
              {item.text ? <p className="text">{item.text}</p> : null}
              <div className="meta">{relativeTime(item.createdAt)}</div>
            </article>
          ))
        )}
        <div ref={endRef} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) sendPhoto(file);
        }}
      />

      {followers ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setFollowers(null)}>
          <div className="sheet">
            <div className="sheet-head">
              <h3>Followers</h3>
              <button
                type="button"
                className="header-btn"
                title="Close"
                onClick={() => setFollowers(null)}
              >
                <IconClose />
              </button>
            </div>
            <div className="sheet-body">
              {followers.length === 0 ? (
                <p className="hint">Nobody follows this channel yet.</p>
              ) : (
                followers.map((follower) => (
                  <div className="pick-row" key={follower.user.id}>
                    <Avatar
                      name={follower.user.displayName}
                      src={follower.user.avatar}
                      size={38}
                    />
                    <span className="body">
                      <b>{follower.user.displayName}</b>
                      <span>followed {relativeTime(follower.followedAt)}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {channel.isOwner ? (
        <div className="ch-composer">
          <button
            type="button"
            className="ch-round"
            title="Add a photo"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <IconCamera size={21} />
          </button>
          <textarea
            rows={1}
            value={text}
            maxLength={MAX_TEXT}
            placeholder="Post to your channel"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          <button
            type="button"
            className="ch-send"
            title="Post"
            disabled={sending || !text.trim()}
            onClick={sendText}
          >
            <IconSend size={19} />
          </button>
        </div>
      ) : (
        <p className="ch-note">
          Only {channel.name} can post here. You are following this channel.
        </p>
      )}
    </div>
  );
}
