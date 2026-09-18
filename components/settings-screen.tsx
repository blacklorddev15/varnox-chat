'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { relativeTime } from '@/lib/format';
import type {
  PrivacyWho,
  PublicUser,
  StatusPrivacyWho,
  UserSettings,
  WallpaperId,
} from '@/lib/types';
import { post } from '@/lib/client';
import { formatPhone } from '@/lib/phone';
import {
  enableNativeNotifications,
  nativeNotificationDiagnostics,
  nativeNotificationsAvailable,
  sendTestNotification,
  setNativeNotifications,
  type NotificationDiagnostics,
} from '@/lib/native-notifications';
import { Avatar } from './avatar';
import { IconBack, IconBell, IconBlock, IconBot, IconChat, IconLink, IconLock, IconPalette, IconStar, IconTrash, IconUser, IconWhatsApp } from './icons';

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

/** Updates have no 'nobody': the narrowest audience is the people you already chat with. */
const STATUS_WHO: { id: StatusPrivacyWho; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'chats', label: 'My chats' },
];

/**
 * Whether the background connection is really working, as the shell sees it.
 *
 * Only says anything inside the app, where notifications are a foreground service rather than a
 * browser permission — and where failure is invisible from the outside. A shell that is running
 * but delivering nothing draws the same screen as nobody having messaged, which is why this is
 * here rather than in a log: the person who is not receiving notifications is the one who can
 * see which step failed.
 *
 * Read every ten seconds while the section is open, and not at all otherwise. The state it shows
 * changes when messages are fetched, so a stale reading would be worse than none.
 */
function NotificationHealth() {
  const [state, setState] = useState<NotificationDiagnostics | null>(null);

  useEffect(() => {
    const read = () => setState((prev) => nativeNotificationDiagnostics() ?? prev);
    read();
    const id = window.setInterval(read, 10_000);
    return () => window.clearInterval(id);
  }, []);

  // No shell to ask, so nothing to say — a browser tab manages its own notifications.
  if (!state) return null;

  const line = !state.permitted
    ? 'Android refused notification permission, so nothing can be shown. Switch this off and on again to be asked.'
    : !state.running
      ? 'The background connection is not running. Switch this off and on again to restart it.'
      : state.problem
        ? `Running, but not delivering: ${state.problem}.`
        : state.chats >= 0
          ? `Working — last checked ${relativeTime(state.lastPollAt)}, ${state.chats} conversation${state.chats === 1 ? '' : 's'} seen.`
          : 'Running. Waiting for the first check.';

  return (
    <p className="hint" style={{ padding: '0 22px' }}>
      {line}
    </p>
  );
}

export function SettingsScreen({
  me,
  isAdmin,
  settings,
  onBack,
  onSave,
  onEditProfile,
  onLinkedDevices,
  onLinkWhatsApp,
  onSignOut,
  onOpenStarred,
  onToast,
}: {
  me: PublicUser;
  /** Whether the viewer may open the owner's controls. Decided on the server, never here. */
  isAdmin: boolean;
  settings: UserSettings;
  onBack: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<UserSettings | null>;
  onEditProfile: () => void;
  onLinkedDevices: () => void;
  onLinkWhatsApp: () => void;
  onSignOut: () => void;
  onOpenStarred: () => void;
  onToast: (message: string) => void;
}) {
  const [section, setSection] = useState<'root' | 'privacy' | 'wallpaper' | 'notifications'>('root');
  const [busy, setBusy] = useState(false);
  /* Deleting is confirmed by typing the handle, and the prompt is inline rather than a section
     of its own: it is one irreversible action, not a place to browse. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delTyped, setDelTyped] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState('');

  async function deleteMine() {
    if (delBusy) return;
    setDelBusy(true);
    setDelError('');
    try {
      await post('/api/account/delete', { username: delTyped.trim() });
      // The session cookie is gone and the account with it. Leaving the app is the only honest
      // place to end up, and the parent already knows how to do that.
      onSignOut();
    } catch (err) {
      setDelError(err instanceof Error ? err.message : 'Could not delete the account');
    } finally {
      setDelBusy(false);
    }
  }

  async function askNotifications(next: boolean) {
    // Inside the Android app the work is a foreground service, not a browser notification, so
    // the browser's own permission API is the wrong instrument — and it does not exist in a
    // WebView to be called anyway.
    if (nativeNotificationsAvailable()) {
      setNativeNotifications(next);
      if (!next) {
        await onSave({ notifications: false });
        return;
      }
      const granted = await enableNativeNotifications();
      await onSave({ notifications: granted });
      onToast(granted ? 'Notifications on' : 'Android refused notification permission');
      return;
    }

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
          onClick={() => (section === 'root' ? onBack() : setSection('root'))}
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
              {/* Purely cosmetic, and deliberately so: this screen has no tier behind it, so
                  the pill is a label on the card rather than a claim the account can check
                  against anything. Wire it to a real field before it means something. */}
              <span className="premium-badge">Premium</span>
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
              <button type="button" className="settings-row" onClick={onLinkedDevices}>
                <span className="ic">
                  <IconLink />
                </span>
                <span className="txt">
                  Linked devices
                  <small>See where you are signed in, or link another device</small>
                </span>
              </button>
              <button type="button" className="settings-row" onClick={onLinkWhatsApp}>
                <span className="ic">
                  <IconWhatsApp />
                </span>
                <span className="txt">
                  Link WhatsApp
                  <small>Pair a WhatsApp number with the bot that answers for it</small>
                </span>
              </button>
              {/* A second way in, beside the menu entry and the phone tab. Bots is a page of its
                  own rather than a panel, so this is a Link — the same arrangement the Admin
                  control row below uses. */}
              <Link href="/bots" className="settings-row">
                <span className="ic">
                  <IconBot />
                </span>
                <span className="txt">
                  Bots
                  <small>Telegram bots you own, and their Varnox API tokens</small>
                </span>
              </Link>
              <Link href="/bots/support" className="settings-row">
                <span className="ic">
                  <IconBot />
                </span>
                <span className="txt">
                  Support bot
                  <small>Create and manage bots by talking to it</small>
                </span>
              </Link>
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
              {/* Above Sign out, and styled the same warning colour: both leave, this one
                  does not come back. */}
              <button
                type="button"
                className="settings-row warn"
                onClick={() => setConfirmDelete((prev) => !prev)}
              >
                <span className="ic">
                  <IconTrash />
                </span>
                <span className="txt">
                  Delete account
                  <small>Removes the account for good. This cannot be undone.</small>
                </span>
              </button>

              {confirmDelete ? (
                <div className="danger-confirm">
                  <p className="hint">
                    This cannot be undone. Your messages stay with the people you sent them to.
                    Type your username to confirm.
                  </p>
                  <input
                    value={delTyped}
                    onChange={(e) => setDelTyped(e.target.value)}
                    placeholder="your username"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  {delError ? <p className="hint error">{delError}</p> : null}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn danger"
                      disabled={delBusy || !delTyped.trim()}
                      onClick={() => void deleteMine()}
                    >
                      {delBusy ? 'Deleting…' : 'Delete my account'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setConfirmDelete(false);
                        setDelTyped('');
                        setDelError('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

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
              <div className="label">Status updates</div>
              <div className="seg-row">
                {STATUS_WHO.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`seg${settings.privacy.statusPrivacy === o.id ? ' on' : ''}`}
                    onClick={() =>
                      onSave({ privacy: { ...settings.privacy, statusPrivacy: o.id } }).then(() =>
                        onToast('Privacy updated')
                      )
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ padding: '0 22px' }}>
                Who can see the updates you post. <b>My chats</b> limits them to the people you
                already have a direct chat with.
              </p>
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
                {/* Worded for where it is running. A background tab and a closed app are
                    different promises, and the browser wording was being shown in the app. */}
                <small>
                  {nativeNotificationsAvailable()
                    ? 'A notification when a message arrives, even once the app is closed.'
                    : 'Alerts and a chime when a message arrives while Varnox is in a background tab.'}
                </small>
              </span>
              <span className={`switch${settings.notifications ? ' on' : ''}`} />
            </button>
            <p className="hint" style={{ padding: '0 22px' }}>
              {nativeNotificationsAvailable()
                ? 'Android asks for permission the first time you switch this on.'
                : 'Your browser asks for permission the first time you switch this on.'}
            </p>
            <NotificationHealth />
            {nativeNotificationsAvailable() ? (
              <button
                type="button"
                className="settings-row"
                onClick={() => {
                  const asked = sendTestNotification();
                  onToast(
                    asked
                      ? 'Sent — it should appear in a moment. It clears itself.'
                      : 'This app cannot post a test notification'
                  );
                }}
              >
                <span className="txt">
                  Send a test notification
                  {/* Says what the test does and does not prove, because the answer it gives is
                      only half the story — the line above covers the other half. */}
                  <small>
                    Posts one now, to check Android is not blocking Varnox. It does not test whether
                    messages are arriving — the line above does that.
                  </small>
                </span>
                <IconBell />
              </button>
            ) : null}
          </div>
        ) : null}

        {/**
         * Last on the page on purpose. It shows only for an account on the allowlist, and being
         * at the end keeps it out of the way of the settings people actually change — as well as
         * out of the way of anyone looking over a shoulder for a way in.
         */}
        {isAdmin ? (
          <div className="settings-group">
            <div className="label">Owner</div>
            <Link href="/admin" className="settings-row">
              <span className="ic">
                <IconLock />
              </span>
              <span className="txt">
                Admin control
                <small>Accounts, reports, blocked numbers.</small>
              </span>
            </Link>
            <p className="hint" style={{ padding: '0 22px' }}>
              Asks for the admin password before anything can be changed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
