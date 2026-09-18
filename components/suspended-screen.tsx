'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { msUntilUsable, suspensionBlocksUse, suspensionState } from '@/lib/suspension';
import { IconLogo } from './icons';
import type { Suspension } from '@/lib/types';

/**
 * What a suspended account sees instead of the app.
 *
 * A screen rather than a sign-out, and that is the whole design. Signing the account out would
 * leave it looking at the sign-in form with no explanation — which reads as a broken app, and
 * invites the person to keep retrying a password that was never the problem. It would also throw
 * away the session, which is the only thing that proves who is asking when they request a review.
 *
 * The banner is deliberately loud and the wording is plain. This screen has one job: say that
 * the account cannot be used, and give a way to ask about it.
 */
export function SuspendedScreen({ suspension }: { suspension: Suspension }) {
  const router = useRouter();
  const [sentAt, setSentAt] = useState<number | null>(suspension.reviewRequestedAt);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * The clock, re-read once a second.
   *
   * The suspension lifts on its own, so this screen has to notice that it has — otherwise somebody
   * whose five hours are up sits looking at a countdown that stopped at zero, on a screen that
   * would let them in if only it were asked again.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const until = suspension.until;
  const state = suspensionState(suspension.at, sentAt, until, now);
  const blocked = suspensionBlocksUse(state);
  const waitLeft = msUntilUsable(sentAt, until, now);

  async function askForReview() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await post<{ suspension: Suspension | null }>('/api/account/review');
      setSentAt(res.suspension?.reviewRequestedAt ?? Date.now());
    } catch {
      // The button stays, so a failure is recoverable by pressing it again rather than by
      // reloading and hoping.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await post('/api/auth/logout');
    } catch {
      /* Leaving anyway — a failed sign-out must not strand somebody on this screen. */
    }
    router.replace('/login');
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <IconLogo size={52} />

        <div className="suspend-banner" role="alert">
          <span className="suspend-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>This account can no longer use the Varnox app</strong>
            <span>
              {until
                ? `Access was withdrawn on ${day(suspension.at)} and returns on ${day(
                    until
                  )}. Nothing has been deleted: your chats, your messages and your profile are all still here.`
                : `Access was withdrawn on ${day(
                    suspension.at
                  )}. Nothing has been deleted: your chats, your messages and your profile are all still here.`}
            </span>
          </div>
        </div>

        {suspension.reason ? (
          <p className="suspend-note">
            <strong>Reason given:</strong> {suspension.reason}
          </p>
        ) : null}

        {/*
          This used to say a person reviewed every request. That stopped being true when the
          suspension ladder went in: asking for a review is what starts the clock now, and the
          access comes back on a schedule rather than on somebody's decision. Telling people a
          human was looking — when nobody is — would be the screen lying to the one person with
          the least reason to trust it.
        */}
        <p className="hint">
          {until
            ? `This suspension has a set end, so there is nothing to ask for — access comes back on its own at the time above.`
            : 'If you think this was a mistake, ask for it to be reviewed. Access returns five hours after you ask, and the suspension is dropped entirely a week after that.'}
        </p>

        <div className="suspend-actions">
          {/* Restored first, because it is the one case where the useful thing on screen is the
              way back in rather than an explanation of the wait. */}
          {!blocked ? (
            <>
              <p className="suspend-sent">
                Your access has been restored. Sign in again to carry on — coming back from a
                suspension takes a fresh sign-in.
              </p>
              <button className="btn" onClick={signOut}>
                Sign in again
              </button>
            </>
          ) : until ? (
            /* No appeal button for a dated suspension. It would do nothing — the state machine
               ignores appeals once a date is set — and offering a button that quietly does
               nothing is worse than not offering it. */
            <p className="suspend-sent">
              Access returns on {day(until)} — in {duration(waitLeft)}.
            </p>
          ) : sentAt ? (
            <p className="suspend-sent">
              Review requested on {day(sentAt)}. Access returns in {duration(waitLeft)}.
            </p>
          ) : (
            <button className="btn" onClick={askForReview} disabled={busy}>
              {busy ? 'Sending…' : 'Request review'}
            </button>
          )}

          {failed ? <p className="error">Could not send that. Try again in a moment.</p> : null}

          <button className="btn ghost" onClick={signOut}>
            Sign out
          </button>

          {/* Asked for directly: somebody who cannot use this account should not have to work out
              that they are allowed to make another one. It goes to the registration front door
              rather than the sign-in form, because a new account is what it offers. */}
          <a
            className="btn ghost"
            href="/login?signin=1&mode=register"
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
          >
            Register a new account
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The wait, said the way somebody would say it out loud: "4 hours 12 minutes", not "15240000 ms".
 * Precision beyond the minute is noise when the thing being waited for is hours away.
 */
function duration(ms: number): string {
  if (ms <= 0) return 'no time at all';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
  }
  return `${Math.floor(hours / 24)} days`;
}

/** Long-form date: this is read once, by somebody cross about it, so it spells itself out. */
function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
