'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from './client';
import { SuspendedScreen } from '@/components/suspended-screen';
import type { PublicUser, Suspension } from './types';

/**
 * The gate every signed-in screen shares, on the client.
 *
 * This replaces {@link pageGate}, which did the same job on the server. It had to move because
 * the app now ships inside the Android build: a page that reads the session with `cookies()`
 * cannot be rendered ahead of time, and rendering ahead of time is what lets the app open
 * without a network at all. The check itself is unchanged — it asks `/api/me`, which reconciles
 * the schema, resolves the session and reports suspension from the same place the API always
 * did, so there is still exactly one implementation of "may this account use the app" rather
 * than two that can drift.
 *
 * What the move costs: the answer now arrives a round trip after the screen starts drawing,
 * where the server had it before the first byte. What it buys is the reason for doing it —
 * `/api/me` is a read like any other, so the offline layer keeps it, and an app with no network
 * reopens on the last session it saw instead of on a sign-in form it cannot submit.
 *
 * What it does not change: the API is still gated by `requireUser()` on every route. A page that
 * rendered for somebody who should not see it still fetches nothing, which is the property that
 * actually matters — the gate is a convenience for the person, and the API is the enforcement.
 *
 * Deletion needs no branch here either: `/api/me` answers with no user for a deleted account,
 * which takes the same path as never having signed in.
 */

type Session = {
  user: PublicUser | null;
  suspension: Suspension | null;
  isAdmin?: boolean;
  google?: boolean;
};

export type GateReady = { me: PublicUser; isAdmin: boolean };

type State =
  | { status: 'checking' }
  | { status: 'ready'; me: PublicUser; isAdmin: boolean }
  | { status: 'suspended'; suspension: Suspension }
  | { status: 'signedOut' }
  /** Nothing cached and nothing reachable — nothing can be said about the session. */
  | { status: 'unreachable' };

/**
 * How often a suspended screen asks whether it still is.
 *
 * A suspension can lift on its own — that is what the countdown on the suspended screen is
 * counting down to — so this screen has to notice. The server version got this for free: the
 * screen asked for itself via `router.refresh()` and the page re-ran. There is no page to re-run
 * now, so the check is repeated here instead. Twenty seconds is close enough to the moment for a
 * screen whose message is already on display, and cheap enough that a suspended account sitting
 * on it all day is nothing.
 *
 * Deliberately only while suspended. Asking constantly would be a second poll on top of the one
 * the app already runs, and a session that ends mid-use is caught by the next API call failing
 * anyway — the same way it was before.
 */
const RECHECK_MS = 20_000;

function useSession(): State {
  const [state, setState] = useState<State>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const session = await api<Session>('/api/me');
        if (cancelled) return;
        if (!session.user) {
          setState({ status: 'signedOut' });
          return;
        }
        if (session.suspension) {
          setState({ status: 'suspended', suspension: session.suspension });
          return;
        }
        setState({ status: 'ready', me: session.user, isAdmin: session.isAdmin === true });
      } catch {
        if (cancelled) return;
        // Nothing was cached and nothing answered. A screen that was already usable stays
        // usable — a poll failing to refresh a page is not a reason to take it away — and
        // otherwise this says so rather than painting an empty app or a sign-in form that
        // cannot be submitted.
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'unreachable' }));
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const suspended = state.status === 'suspended';

  useEffect(() => {
    if (!suspended) return;
    let cancelled = false;

    async function recheck() {
      try {
        const session = await api<Session>('/api/me');
        if (cancelled) return;
        if (!session.user) {
          setState({ status: 'signedOut' });
          return;
        }
        if (!session.suspension) {
          setState({ status: 'ready', me: session.user, isAdmin: session.isAdmin === true });
        }
      } catch {
        // A re-check that fails leaves the screen exactly as it is. There is nothing to tell
        // somebody who is already being told their account is suspended, and the next tick tries
        // again — so this stays silent rather than stacking a second message on the first.
      }
    }

    const id = window.setInterval(() => void recheck(), RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [suspended]);

  return state;
}

/** Sends the browser somewhere as soon as this renders, once. */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}

function Waiting() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="admin-title">Varnox</div>
      </div>
    </div>
  );
}

function Unreachable() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Can&rsquo;t reach Varnox</h1>
        <p className="sub">
          This screen needs a connection the first time it is opened. Once it has been opened
          once, it will work without one.
        </p>
      </div>
    </div>
  );
}

/**
 * Renders its children once the session is known, and takes care of the three cases where they
 * must not be rendered.
 *
 * A render prop rather than a hook call at the top of each page, so that `me` is not optional
 * inside the page: there is no arrangement in which a page draws with a null user, because the
 * only code that can draw is the callback, and it is handed a real one.
 */
export function Gate({ children }: { children: (gate: GateReady) => ReactElement }) {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSession();

  useEffect(() => {
    if (state.status !== 'signedOut') return;
    // `next` is what makes signing in land where the person was going. The server gate never
    // sent it, so this is one small thing better than what it replaces.
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [state.status, pathname, router]);

  if (state.status === 'ready') return children({ me: state.me, isAdmin: state.isAdmin });
  if (state.status === 'suspended') return <SuspendedScreen suspension={state.suspension} />;
  if (state.status === 'unreachable') return <Unreachable />;
  return <Waiting />;
}
