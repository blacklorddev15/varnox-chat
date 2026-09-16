import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bad, clientIp, deviceLabel, userAgent } from '@/lib/api';
import { setSessionCookie } from '@/lib/auth';
import { createDevice, getUser, isAccountDeleted, oauthUserId } from '@/lib/db';
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_TICKET_COOKIE,
  exchangeCode,
  googleConfigured,
  safeNextPath,
  signGoogleTicket,
  verifyGoogleState,
  verifyIdToken,
} from '@/lib/google';
import { ensureSchema } from '@/lib/migrate';

export const dynamic = 'force-dynamic';

const PROVIDER = 'google';

/**
 * GET /api/auth/google/callback — finish a Google sign-in.
 *
 * Every outcome is a redirect to a screen that can explain itself, never a bare error page.
 * This runs in a browser top-level navigation, so a JSON body or a stack trace would leave the
 * visitor looking at text they cannot act on; `/login?google=<reason>` lets the sign-in screen
 * say what happened in its own words, in the place they were already standing.
 *
 * WHAT THIS ROUTE DELIBERATELY DOES NOT DO
 *
 * It never attaches a Google account to an existing Varnox account by matching email. An
 * address on a Google account proves its owner controls that address; this app has never
 * verified an address it stored itself, so treating the two as the same claim would let anyone
 * who can obtain a Google account for a given address sign into the account holding it.
 *
 * A first-time Google visitor is therefore not signed up here. They are handed a signed ticket
 * and sent to the ordinary signup form, which requires a phone number — which is the path that
 * already enforces the phone block. Creating the account here instead would mean a second
 * account-creation route that has to remember to repeat every check the first one makes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  /**
   * Clear the state cookie on every exit. It exists to be compared once, and leaving it behind
   * would let a second callback attempt match a nonce from a sign-in that is already over.
   */
  /**
   * Clear the state cookie on every exit. It exists to be compared once, and leaving it behind
   * would let a second callback attempt match a nonce from a sign-in that is already over. The
   * ticket cookie is cleared too unless this exit is handing over a fresh one, so a stale ticket
   * can never outlive the signup that asked for it.
   */
  const finish = (path: string, ticket?: string) => {
    const res = NextResponse.redirect(new URL(path, origin));
    res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/', maxAge: 0 });
    res.cookies.set(
      GOOGLE_TICKET_COOKIE,
      ticket ?? '',
      ticket
        ? {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 900,
          }
        : { path: '/', maxAge: 0 }
    );
    return res;
  };

  if (!googleConfigured()) return finish('/login?google=unconfigured');

  // The visitor declined, or Google refused. `error` is Google's own code; the sign-in screen
  // turns it into a sentence, and the raw value is only for the log.
  const refused = url.searchParams.get('error');
  if (refused) {
    console.warn('[varnox] google sign-in refused:', refused);
    return finish('/login?google=denied');
  }

  const jar = await cookies();
  const state = verifyGoogleState(url.searchParams.get('state'));
  const cookieNonce = jar.get(GOOGLE_STATE_COOKIE)?.value;

  // Ordered from the cheapest check outward: state must be ours and unexpired, must carry the
  // nonce, and that nonce must be the one this browser was given. A state that verifies but
  // has no matching cookie is a sign-in that started in somebody else's browser.
  if (!state) return finish('/login?google=state');
  if (!cookieNonce || state.nonce !== cookieNonce) return finish('/login?google=state');

  const code = url.searchParams.get('code');
  if (!code) return finish('/login?google=state');

  const exchanged = await exchangeCode({ code, origin });
  if ('error' in exchanged) {
    console.error('[varnox] google token exchange failed:', exchanged.error);
    return finish('/login?google=exchange');
  }

  let identity;
  try {
    identity = await verifyIdToken(exchanged.idToken, state.nonce);
  } catch (err) {
    // Reaching Google's key set can fail on its own, and that is a different problem from a
    // token that does not check out — so it is reported as its own reason rather than folded
    // into the same message.
    console.error('[varnox] could not verify google token:', err instanceof Error ? err.message : err);
    return finish('/login?google=keys');
  }
  if (!identity) return finish('/login?google=token');

  await ensureSchema();

  const linkedId = await oauthUserId(PROVIDER, identity.sub);

  if (linkedId) {
    const user = await getUser(linkedId);
    /**
     * The identity resolves but the account is gone. Deleting an account leaves its identity
     * rows alone — the identifiers are what stop the same Google account being reused — so a
     * deleted account must be refused here rather than signing in against a row that no longer
     * has a user behind it.
     */
    if (!user || (await isAccountDeleted(user.id))) {
      return finish('/login?google=gone');
    }

    // The same device row every other sign-in creates, so this session appears in the device
    // list and can be revoked from another one exactly like a password or SMS session.
    const device = await createDevice(user.id, {
      label: deviceLabel(req),
      userAgent: userAgent(req),
      ip: clientIp(req),
    });
    await setSessionCookie(user.id, device.id);
    // Re-checked here as well as where it was first accepted. The state is signed, so this is
    // belt and braces — but a stored value that becomes a redirect target is worth confirming
    // at the point of use rather than reasoning about from a distance.
    return finish(safeNextPath(state.next, origin) || '/chat');
  }

  // No link. Hand the signup form a signed ticket rather than creating anything here.
  const ticket = signGoogleTicket(identity);
  const destination = new URL('/login', origin);
  destination.searchParams.set('google', 'new');
  const after = safeNextPath(state.next, origin);
  if (after) destination.searchParams.set('next', after);
  // Handed over as an httpOnly cookie, not a query parameter: a ticket in a URL would be written
  // to history, leaked as a Referer, and logged — and anyone who read it could attach this Google
  // account to one of their own before it expired.
  return finish(`${destination.pathname}${destination.search}`, ticket);
}

/** A POST here would invite a form to start a sign-in without going through /api/auth/google. */
export async function POST() {
  return bad('Use GET to sign in with Google', 405);
}
