import { NextResponse } from 'next/server';
import {
  GOOGLE_STATE_COOKIE,
  googleAuthUrl,
  googleConfigured,
  randomNonce,
  safeNextPath,
  signGoogleState,
} from '@/lib/google';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google — begin a Google sign-in.
 *
 * Answers with a redirect rather than JSON, because the browser itself has to be sent to
 * Google. That also lets the button be an ordinary link, so it works before any JavaScript
 * has run and cannot be broken by a component that has not mounted yet.
 *
 * The nonce is written to a cookie *and* into the signed state, and the callback insists the
 * two agree. The signature alone proves the state was minted by this server; the cookie is
 * what proves it was minted for *this browser*, which is the part that stops a state value
 * being generated for one visitor and handed to another.
 *
 * The state lives in a cookie rather than in a database row because it is genuinely
 * short-lived and there is nothing to look up later — a failed or abandoned sign-in should
 * leave no trace and need no cleanup, which a table would not manage by itself.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const next = safeNextPath(url.searchParams.get('next'), origin);

  /**
   * Checked here as well as at the button, so a stale bookmark or a shared link on a
   * deployment whose variables are missing says so in words instead of landing on a Google
   * error page that mentions the client id but not this app.
   */
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL('/login?google=unconfigured', origin));
  }

  const nonce = randomNonce();
  const state = signGoogleState({ nonce, next });

  const res = NextResponse.redirect(googleAuthUrl({ origin, state }));
  // Set on the response rather than through cookies(), because this handler returns a redirect
  // it built itself and the two must not be able to disagree about what was sent.
  res.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
