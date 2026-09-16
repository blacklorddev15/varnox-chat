'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
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
            <strong>This account cannot use Varnox</strong>
            <span>
              Access was withdrawn on {day(suspension.at)}. Nothing has been deleted: your chats,
              your messages and your profile are all still here.
            </span>
          </div>
        </div>

        {suspension.reason ? (
          <p className="suspend-note">
            <strong>Reason given:</strong> {suspension.reason}
          </p>
        ) : null}

        <p className="hint">
          If you think this was a mistake, ask for it to be reviewed. A person looks at these
          requests — nothing here is decided automatically.
        </p>

        <div className="suspend-actions">
          {sentAt ? (
            <p className="suspend-sent">
              Review requested on {day(sentAt)}. You will be able to use Varnox again if the
              suspension is lifted.
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
        </div>
      </div>
    </div>
  );
}

/** Long-form date: this is read once, by somebody cross about it, so it spells itself out. */
function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
