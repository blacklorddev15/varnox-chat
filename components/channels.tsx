'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, uploadImage } from '@/lib/client';
import type { Channel } from '@/lib/types';
import { relativeTime, shortPreview } from '@/lib/format';
import { Avatar } from './avatar';
import { ChannelView } from './channel-view';
import { IconBack, IconCamera, IconClose, IconPlus, IconSearch } from './icons';

/** The same limits the create route enforces, so they are visible while typing. */
const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;

type Panel = 'create' | 'discover' | null;

/** What a row has to say when there is no post to show: the description, or nothing yet. */
function preview(channel: Channel): string {
  const last = channel.lastPost;
  if (last) {
    if (last.kind === 'image') return last.text ? shortPreview(last.text) : 'Photo';
    return shortPreview(last.text ?? '');
  }
  if (channel.description) return shortPreview(channel.description);
  return 'No posts yet';
}

/**
 * The Channels tab: discovery at the top, then the broadcasts you follow. Opening one takes
 * over the screen, so the list, the sheets and the channel itself are all here.
 */
export function ChannelsScreen({
  onBack,
  onToast,
}: {
  /** Back to chats. Hidden on phones, where the tab bar is the way back. */
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<Channel | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [found, setFound] = useState<Channel[]>([]);
  const [finding, setFinding] = useState(false);
  /** The channel whose follow button is mid-flight, so only that row shows as busy. */
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ channels: Channel[] }>('/api/channels');
      setChannels(res.channels);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not load your channels');
    } finally {
      setReady(true);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDiscover = useCallback(async () => {
    setPanel('discover');
    setFound([]);
    setFinding(true);
    try {
      const res = await api<{ channels: Channel[] }>('/api/channels?discover=1');
      setFound(res.channels);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not load channels to follow');
    } finally {
      setFinding(false);
    }
  }, [onToast]);

  const follow = useCallback(
    async (id: string) => {
      setJoining(id);
      try {
        await post(`/api/channels/${id}/follow`);
        // The button flips in place, and the channel appears in the list behind the sheet.
        setFound((prev) =>
          prev.map((c) => (c.id === id ? { ...c, following: true, followers: c.followers + 1 } : c))
        );
        await load();
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not follow that channel');
      } finally {
        setJoining(null);
      }
    },
    [load, onToast]
  );

  const pickAvatar = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const up = await uploadImage(file);
        setAvatar(up.url);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not upload that photo');
      } finally {
        setUploading(false);
      }
    },
    [onToast]
  );

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await post<{ channel: Channel }>('/api/channels', {
        name: trimmed,
        description: description.trim(),
        avatar,
      });
      setName('');
      setDescription('');
      setAvatar('');
      setPanel(null);
      await load();
      // Straight into the new channel: an empty channel is only worth looking at once you can
      // see where to post.
      setOpen(res.channel);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create that channel');
    } finally {
      setCreating(false);
    }
  }, [avatar, creating, description, load, name, onToast]);

  const closeView = useCallback(() => {
    setOpen(null);
    // The header count and the unread dot have both moved while the channel was open.
    load();
  }, [load]);

  return (
    <div className="updates">
      <div className="updates-head">
        <button type="button" className="updates-back" onClick={onBack} title="Back to chats">
          <IconBack size={22} />
        </button>
        <h2>Channels</h2>
      </div>

      <div className="updates-body">
        <div className="ch-top">
          <button type="button" className="settings-row" onClick={openDiscover}>
            <span className="ic">
              <IconSearch size={20} />
            </span>
            <span className="txt">
              Discover channels
              <small>Find broadcasts to follow</small>
            </span>
          </button>
          <button
            type="button"
            className="ch-round"
            title="New channel"
            onClick={() => setPanel('create')}
          >
            <IconPlus size={20} />
          </button>
        </div>

        {!ready ? (
          <div className="loading">Loading channels…</div>
        ) : channels.length === 0 ? (
          <p className="hint" style={{ padding: '18px 16px' }}>
            You are not following any channels yet. Discover one to follow, or create your own and
            post to it.
          </p>
        ) : (
          <>
            <div className="list-label">Your channels</div>
            {channels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                className="chat-item"
                onClick={() => setOpen(channel)}
              >
                <Avatar name={channel.name} src={channel.avatar} size={49} />
                <span className="chat-item-body">
                  <span className="chat-item-top">
                    <span className="chat-item-name">{channel.name}</span>
                    <span className={`chat-item-time${channel.unread > 0 ? ' unread' : ''}`}>
                      {relativeTime(channel.lastPostAt ?? channel.createdAt)}
                    </span>
                  </span>
                  <span className="chat-item-bottom">
                    <span className="chat-item-preview">{preview(channel)}</span>
                    {channel.unread > 0 ? (
                      <span
                        className="ch-dot"
                        title={`${channel.unread} new ${channel.unread === 1 ? 'post' : 'posts'}`}
                      />
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
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
          if (file) pickAvatar(file);
        }}
      />

      {panel === 'discover' ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div className="sheet">
            <div className="sheet-head">
              <h3>Discover channels</h3>
              <button
                type="button"
                className="header-btn"
                title="Close"
                onClick={() => setPanel(null)}
              >
                <IconClose />
              </button>
            </div>
            <div className="sheet-body">
              {finding ? (
                <div className="loading">Looking for channels…</div>
              ) : found.length === 0 ? (
                <p className="hint">
                  No channels to follow yet. Anyone can start one — and yours would show up here
                  for everybody else.
                </p>
              ) : (
                found.map((channel) => (
                  <div className="pick-row" key={channel.id}>
                    <Avatar name={channel.name} src={channel.avatar} size={42} />
                    <span className="body">
                      <b>{channel.name}</b>
                      <span>
                        {channel.followers}{' '}
                        {channel.followers === 1 ? 'follower' : 'followers'}
                        {channel.description ? ` · ${shortPreview(channel.description, 40)}` : ''}
                      </span>
                    </span>
                    {channel.following ? (
                      <span className="tag">Following</span>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost ch-follow"
                        disabled={joining === channel.id}
                        onClick={() => follow(channel.id)}
                      >
                        {joining === channel.id ? 'Following…' : 'Follow'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {panel === 'create' ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div className="sheet">
            <div className="sheet-head">
              <h3>New channel</h3>
              <button type="button" className="header-btn" title="Close" onClick={() => setPanel(null)}>
                <IconClose />
              </button>
            </div>
            <div className="sheet-body">
              <button
                type="button"
                className="pick-row"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {avatar ? (
                  <Avatar name={name || 'Channel'} src={avatar} size={49} />
                ) : (
                  <span className="ch-ic">
                    <IconCamera size={22} />
                  </span>
                )}
                <span className="body">
                  <b>{uploading ? 'Uploading…' : avatar ? 'Change photo' : 'Add a photo'}</b>
                  <span>Optional. Channels without one show their first letter.</span>
                </span>
              </button>

              <div className="field-row">
                <label htmlFor="ch-name">Channel name</label>
                <input
                  id="ch-name"
                  className="input"
                  value={name}
                  maxLength={MAX_NAME}
                  placeholder="e.g. Product news"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field-row">
                <label htmlFor="ch-desc">Description</label>
                <input
                  id="ch-desc"
                  className="input"
                  value={description}
                  maxLength={MAX_DESCRIPTION}
                  placeholder="What this channel is about"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <p className="hint">
                Only you will be able to post. Everyone who follows can read what you post and see
                how many followers you have.
              </p>
            </div>
            <div className="sheet-foot">
              <button
                type="button"
                className="btn ghost"
                disabled={creating}
                onClick={() => setPanel(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={creating || !name.trim()}
                onClick={create}
              >
                {creating ? 'Creating…' : 'Create channel'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {open ? <ChannelView channel={open} onBack={closeView} onToast={onToast} /> : null}
    </div>
  );
}
