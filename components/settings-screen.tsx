'use client';

import { useState } from 'react';
import type { PrivacyWho, PublicUser, UserSettings, WallpaperId } from '@/lib/types';
import { formatPhone } from '@/lib/phone';
import { Avatar } from './avatar';
import {
  IconBack,
  IconBell,
  IconBlock,
  IconChat,
  IconLock,
  IconPalette,
  IconStar,
  IconUser,
} from './icons';

const WALLS: { id: WallpaperId; label: string }[] = [
  { id: 'doodle', label: 'Doodle' },
  { id: 'plain', label: 'Plain' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'leaf', label: 'Bubbles' },
];

const WHO: { id: PrivacyWho; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'nobody', label: 'Nobody' },
];

export function SettingsScreen({
  me,
  settings,
  onClose,
  onSave,
  onEditProfile,
  onSignOut,
  onOpenStarred,
  onToast,
}: {
  me: PublicUser;
  settings: UserSettings;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<UserSettings | null>;
  onEditProfile: () => void;
  onSignOut: () => void;
  onOpenStarred: () => void;
  onToast: (message: string) => void;
}) {
  const [section, setSection] = useState<'root' | 'privacy' | 'wallpaper' | 'notifications'>('root');
  const [busy, setBusy] = useState(false);

  async function askNotifications(next: boolean) {
    if (!next) {
      await onSave({ notifications: false });
      return;
    }
    if (typeof Notification === 'undefined') {
      onToast('This browser does not support notifications');
      return;
    }
    if (Notification.permission === 'granted') {
      await onSave({ notifications: true });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await onSave({ notifications: true });
      onToast('Notifications on');
    } else {
      await onSave({ notifications: false });
      onToast('The browser refused notification permission');
    }
  }

  return (
    <div className="settings-screen">
      <div className="settings-head">
        <button
          type="button"
          className="header-btn"
          onClick={() => (section === 'root' ? onClose() : setSection('root'))}
          title="Back"
        >
          <IconBack />
        </button>
        <h2>
          {section === 'root'
            ? 'Settings'
            : section === 'privacy'
              ? 'Privacy'
              : section === 'wallpaper'
                ? 'Chat wallpaper'
                : 'Notifications'}
        </h2>
      </div>

      <div className="settings-body">
        {section === 'root' ? (
          <>
            <button type="button" className="settings-profile" onClick={onEditProfile}>
              <Avatar name={me.displayName} src={me.avatar} size={76} />
              <span style={{ textAlign: 'left', flex: 1 }}>
                <div className="nm">{me.displayName}</div>
                <div className="ab">{formatPhone(me.phone) || `@${me.username}`}</div>
                <div className="ab">{me.about || 'Hey there! I am using Varnox.'}</div>
              </span>
            </button>

            <div className="settings-group">
              <div className="label">Account</div>
              <button type="button" className="settings-row" onClick={onEditProfile}>
                <span className="ic">
                  <IconUser />
                </span>
                <span className="txt">
                  Profile
                  <small>
                    {formatPhone(me.phone) || `@${me.username}`} · name, photo, number and about
                  </small>
                </span>
              </button>
              <button type="button" className="settings-row" onClick={() => setSection('privacy')}>
                <span className="ic">
                  <IconLock />
                </span>
                <span className="txt">
                  Privacy
                  <small>Last seen, profile photo and read receipts</small>
                </span>
              </button>
            </div>

            <div className="settings-group">
              <div className="label">Chats</div>
              <button type="button" className="settings-row" onClick={onOpenStarred}>
                <span className="ic">
                  <IconStar />
                </span>
                <span className="txt">
                  Starred messages
                  <small>Messages you kept with a star</small>
                </span>
              </button>
              <button type="button" className="settings-row" onClick={() => setSection('wallpaper')}>
                <span className="ic">
                  <IconPalette />
                </span>
                <span className="txt">
                  Chat wallpaper
                  <small>Current: {WALLS.find((w) => w.id === settings.wallpaper)?.label}</small>
                </span>
              </button>
              <button type="button" className="settings-row" onClick={() => setSection('notifications')}>
                <span className="ic">
                  <IconBell />
                </span>
                <span className="txt">
                  Notifications
                  <small>{settings.notifications ? 'On' : 'Off'}</small>
                </span>
              </button>
            </div>

            <div className="settings-group">
              <div className="label">Blocked contacts</div>
              {settings.blocked.length === 0 ? (
                <div className="settings-row">
                  <span className="ic">
                    <IconBlock />
                  </span>
                  <span className="txt">
                    Nobody is blocked
                    <small>Block someone from their contact info</small>
                  </span>
                </div>
              ) : (
                settings.blocked.map((id) => (
                  <div key={id} className="settings-row">
                    <span className="ic">
                      <IconBlock />
                    </span>
                    <span className="txt">
                      Blocked contact
                      <small>{id}</small>
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={async () => {
                        setBusy(true);
                        await onSave({ blocked: settings.blocked.filter((b) => b !== id) });
                        setBusy(false);
                        onToast('Contact unblocked');
                      }}
                      disabled={busy}
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="settings-group">
              <div className="label">About</div>
              <div className="settings-row">
                <span className="ic">
                  <IconChat />
                </span>
                <span className="txt">
                  Varnox
                  <small>
                    Your own messenger, running on your own server. Messages live in your Vercel Blob
                    store — nothing is shared with any other messenger.
                  </small>
                </span>
              </div>
              <button type="button" className="settings-row warn" onClick={onSignOut}>
                <span className="ic">
                  <IconUser />
                </span>
                <span className="txt">Sign out</span>
              </button>
            </div>
          </>
        ) : null}

        {section === 'privacy' ? (
          <>
            <div className="settings-group">
              <div className="label">Last seen and online</div>
              <div className="seg-row">
                {WHO.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`seg${settings.privacy.lastSeen === o.id ? ' on' : ''}`}
                    onClick={() =>
                      onSave({ privacy: { ...settings.privacy, lastSeen: o.id } }).then(() =>
                        onToast('Privacy updated')
                      )
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ padding: '0 22px' }}>
                Controls who can see when you were last online. Choosing <b>Nobody</b> also hides the
                online dot from everyone else.
              </p>
            </div>

            <div className="settings-group">
              <div className="label">Profile photo</div>
              <div className="seg-row">
                {WHO.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`seg${settings.privacy.profilePhoto === o.id ? ' on' : ''}`}
                    onClick={() =>
                      onSave({ privacy: { ...settings.privacy, profilePhoto: o.id } }).then(() =>
                        onToast('Privacy updated')
                      )
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <div className="label">Read receipts</div>
              <button
                type="button"
                className="settings-row"
                onClick={() =>
                  onSave({
                    privacy: { ...settings.privacy, readReceipts: !settings.privacy.readReceipts },
                  }).then(() => onToast('Privacy updated'))
                }
              >
                <span className="txt">
                  Send read receipts
                  <small>
                    When off, others never see blue ticks from you — you also stop seeing theirs.
                  </small>
                </span>
                <span className={`switch${settings.privacy.readReceipts ? ' on' : ''}`} />
              </button>
            </div>
          </>
        ) : null}

        {section === 'wallpaper' ? (
          <div className="settings-group">
            <div className="label">Pick a chat wallpaper</div>
            <div className="wall-grid">
              {WALLS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`wall-swatch${settings.wallpaper === w.id ? ' on' : ''}`}
                  onClick={() => onSave({ wallpaper: w.id }).then(() => onToast('Wallpaper updated'))}
                >
                  <span className="wall-preview" data-w={w.id} />
                  <b>{w.label}</b>
                </button>
              ))}
            </div>
            <p className="hint" style={{ padding: '0 22px' }}>
              The wallpaper applies to your chat canvas on this account.
            </p>
          </div>
        ) : null}

        {section === 'notifications' ? (
          <div className="settings-group">
            <div className="label">Message notifications</div>
            <button
              type="button"
              className="settings-row"
              onClick={() => askNotifications(!settings.notifications)}
            >
              <span className="txt">
                Show notifications
                <small>
                  Alerts and a chime when a message arrives while Varnox is in a background tab.
                </small>
              </span>
              <span className={`switch${settings.notifications ? ' on' : ''}`} />
            </button>
            <p className="hint" style={{ padding: '0 22px' }}>
              Your browser asks for permission the first time you switch this on.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
