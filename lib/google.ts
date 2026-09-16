import crypto from 'node:crypto';

/**
 * Google sign-in, as a second way to prove you are the person who owns an account.
 *
 * The shape of this module follows lib/auth.ts rather than inventing a second session
 * mechanism: a successful exchange ends by the caller minting the same signed session cookie
 * a password or an SMS code mints. Everything downstream — devices, revocation from another
 * device, the deleted-account check — therefore keeps working without knowing Google exists.
 *
 * THREE DECISIONS WORTH WRITING DOWN
 *
 * 1. Nothing is auto-linked by email. An address on a Google account does prove the Google
 *    account's owner controls it, but this app has never verified an address it stored
 *    itself (see lib/types.ts: "Not yet verified by any proof of ownership"). Matching the
 *    two would let anyone who can create a Google account for a given address walk into the
 *    account that happens to hold the same one. So a Google identity is only ever attached
 *    deliberately, by claiming a fresh registration through a signed ticket (below). A sign-in
 *    that finds no link never attaches itself to an account it merely recognises — it reports
 *    that none is attached and stops there. (Attaching Google to an account that already exists
 *    is a separate feature and needs a route requiring that account's own live session; nothing
 *    here provides one.)
 *
 * 2. A new Google user still registers, and registration is where the phone block lives.
 *    Rather than add a second account-creation path that would have to remember to repeat
 *    every check, the callback hands the browser a signed ticket and sends it to the ordinary
 *    signup form. The number is then checked by the same code that checks it for everybody
 *    else, so a blocked number cannot slip in through this door. That is the whole reason the
 *    ticket exists instead of an account being created during the callback.
 *
 * 3. The id_token's signature is verified against Google's published keys. The token does
 *    arrive over TLS from Google's own token endpoint, so some implementations skip this;
 *    verifying anyway means a mistake elsewhere — a proxy, a logged URL, a swapped endpoint —
 *    cannot quietly turn into an accepted identity.
 *
 * State and ticket tokens are signed with SESSION_SECRET, the same key the session cookie
 * uses, and are purpose-bound the way the admin unlock token is: a state token has no uid and
 * a ticket's purpose is checked, so neither can be replayed as a session and a session cannot
 * be replayed as either. The three are not interchangeable in any direction.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CERTS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Both spellings are accepted: Google has issued id_tokens with the bare host and with the
 * scheme prefix, and rejecting the older one would break sign-in for no security benefit.
 */
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Only what sign-in needs. Nothing here reads the user's mail, files or contacts. */
const SCOPE = 'openid email profile';

const STATE_COOKIE = 'vx_oauth_state';

/**
 * Where a verified-but-accountless Google identity waits while the visitor finishes signing up.
 *
 * A cookie rather than a query parameter, deliberately. As `?ticket=…` it would be written to
 * browser history, sent as a `Referer` to anything the signup page loads, and left in every
 * access log on the way — and whoever read it in that fifteen minute window could attach that
 * Google account to an account of their own, locking the real owner out of ever linking it. In
 * an httpOnly cookie it is not readable by script, not part of any URL, and dies with the tab.
 */
const TICKET_COOKIE = 'vx_oauth_ticket';

/** Long enough to read a consent screen, short enough that a leaked link goes stale. */
const STATE_MS = 10 * 60_000;

/** A ticket is carried through a signup form, so it only has to outlive that. */
const TICKET_MS = 15 * 60_000;

const SECRET = process.env.SESSION_SECRET || 'varnox-local-dev-secret';

export function googleClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

function googleClientSecret(): string {
  return (process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

/**
 * Whether this deployment can offer Google sign-in at all.
 *
 * Checked before the button is drawn and again at the start of the flow, so a half-configured
 * deployment (an id but no secret, which is what a copied-but-not-pasted env var looks like)
 * says so plainly instead of sending somebody to a Google error page.
 */
export function googleConfigured(): boolean {
  return googleClientId().length > 0 && googleClientSecret().length > 0;
}

/**
 * The address Google must send the browser back to.
 *
 * Derived from the request rather than stored in an env var, so localhost and production each
 * get their own without a second setting to keep in step. It has to match a redirect URI
 * registered on the client *exactly* — the scheme, the host and the path, with no trailing
 * slash — which is why this is one function rather than a string repeated in two routes.
 */
export function redirectUriFor(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(body: string): string {
  return b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
}

/** Constant-time compare, so a wrong token cannot be found a byte at a time. */
function signatureMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Signed<T> = { body: string; payload: T } | null;

function openSigned<T extends { exp: number }>(token: string | undefined | null): Signed<T> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!signatureMatches(sig, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return { body, payload };
  } catch {
    return null;
  }
}

/* ── the state token: proves the callback belongs to a sign-in this browser started ─────── */

export type GoogleState = {
  purpose: 'google-state';
  nonce: string;
  /** Where to land afterwards. Kept to a relative path by the caller, never a full URL. */
  next?: string;
  exp: number;
};

export const GOOGLE_STATE_COOKIE = STATE_COOKIE;

export const GOOGLE_TICKET_COOKIE = TICKET_COOKIE;

/**
 * A path on this site that a sign-in may end up at, or undefined.
 *
 * Checked by RESOLVING the value, not by pattern-matching it, and the difference was found the
 * hard way: a leading-slash test looks sufficient and is not. `new URL()` treats a backslash as
 * a forward slash for http(s), so `/\evil.com` passes "starts with a single slash, not two" and
 * then resolves to `https://evil.com/` — an open redirect reachable from the sign-in flow. The
 * ask is therefore made of the same constructor the browser will use, and the answer is only
 * accepted when the resolved origin is this one.
 *
 * Returns a path rather than the resolved absolute URL on purpose: the caller then cannot
 * accidentally hand a foreign origin to a redirect.
 */
export function safeNextPath(
  value: string | null | undefined,
  origin: string
): string | undefined {
  if (!value) return undefined;
  let here: URL;
  let resolved: URL;
  try {
    here = new URL(origin);
    /**
     * The origin has to be a real web origin, checked before anything else.
     *
     * For a non-special scheme this whole function quietly stops working: `new URL('javascript://h')`
     * has an `origin` of the literal string "null", so the comparison further down would pass
     * trivially — both sides "null" — and backslash-to-slash normalisation only applies to http(s),
     * so `/\evil.com` would survive the single-slash test and be handed back as a path that a
     * browser then resolves off-site. Refusing anything that is not http(s) closes that class for
     * every caller, including ones that have not thought about their own origin at all.
     */
    if (here.protocol !== 'http:' && here.protocol !== 'https:') return undefined;
    resolved = new URL(value, here);
  } catch {
    return undefined;
  }
  if (resolved.origin !== here.origin) return undefined;

  const out = resolved.pathname + resolved.search + resolved.hash;
  /**
   * The origin check above is NOT sufficient on its own, and this is the part worth remembering.
   * A path can normalise *into* an authority: `/..//evil.com` resolves to this origin carrying a
   * pathname of exactly `//evil.com`. A value beginning `//` is read authority-first the moment
   * it is used as a relative URL, so returning that pathname would hand the caller a string that
   * leaves the site — having just passed the origin test. Requiring a single leading slash is
   * what makes the result safe to redirect to by itself, instead of safe only for as long as
   * every caller remembers to run the check a second time.
   */
  if (!out.startsWith('/') || out.startsWith('//')) return undefined;
  return out.slice(0, 200);
}

export function signGoogleState(input: { nonce: string; next?: string }): string {
  const payload: GoogleState = {
    purpose: 'google-state',
    nonce: input.nonce,
    exp: Date.now() + STATE_MS,
  };
  if (input.next) payload.next = input.next;
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyGoogleState(token: string | undefined | null): GoogleState | null {
  const opened = openSigned<GoogleState>(token);
  if (!opened || opened.payload.purpose !== 'google-state') return null;
  if (!opened.payload.nonce) return null;
  return opened.payload;
}

export function randomNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * The URL the browser is sent to.
 *
 * `prompt=select_account` is deliberate: without it, a browser already signed in to one Google
 * account goes straight through, which on a shared device offers no chance to pick a different
 * one. `access_type=online` is correct here because nothing is fetched on the user's behalf
 * later — no refresh token is wanted.
 */
export function googleAuthUrl(input: { origin: string; state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', googleClientId());
  url.searchParams.set('redirect_uri', redirectUriFor(input.origin));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', input.state);
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('include_granted_scopes', 'true');
  return url.toString();
}

/** Swap the one-time code for tokens. Called server to server, so the secret never leaves here. */
export async function exchangeCode(input: {
  code: string;
  origin: string;
}): Promise<{ idToken: string } | { error: string }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: redirectUriFor(input.origin),
    grant_type: 'authorization_code',
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
  } catch {
    return { error: 'Could not reach Google to complete the sign-in' };
  }

  const text = await res.text();
  let parsed: { id_token?: string; error?: string; error_description?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { error: 'Google returned a response that could not be read' };
  }

  if (!res.ok || parsed.error) {
    // error_description is Google's own wording and is safe to show — it is about the code,
    // not about this app's configuration. Falling back to the code keeps the message useful.
    return { error: parsed.error_description || parsed.error || 'Google refused the sign-in' };
  }
  if (!parsed.id_token) return { error: 'Google did not return an identity token' };

  return { idToken: parsed.id_token };
}

/* ── verifying the id_token ─────────────────────────────────────────────────────────────── */

type Jwk = { kty?: string; kid?: string; n?: string; e?: string; alg?: string; use?: string };

/**
 * Google's signing keys, cached in the process for an hour.
 *
 * Keyed by `kid` because Google rotates keys and keeps more than one live at a time, so a
 * token signed a moment before a rotation must still verify. A failed fetch is not cached,
 * so the next attempt tries again rather than serving an empty set for an hour.
 */
let keyCache: { at: number; byKid: Map<string, crypto.KeyObject> } | null = null;

async function googleSigningKeys(): Promise<Map<string, crypto.KeyObject>> {
  const now = Date.now();
  if (keyCache && now - keyCache.at < 60 * 60_000) return keyCache.byKid;

  const res = await fetch(CERTS_ENDPOINT, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not reach Google to check the sign-in token');

  const body = (await res.json()) as { keys?: Jwk[] };
  const byKid = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
    byKid.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' } as unknown as crypto.PublicKeyInput));
  }
  if (!byKid.size) throw new Error('Google published no usable signing keys');

  keyCache = { at: now, byKid };
  return byKid;
}

export type GoogleIdentity = {
  /** Google's stable id for the account. Never the email: an address can be changed. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

/**
 * Check an id_token's signature and every claim that matters.
 *
 * Every failure returns null rather than throwing, because a token that does not check out is
 * not an error condition to report — it is simply not an identity. The `nonce` is required and
 * must match the one this browser's state token carried, which is what binds the token to the
 * sign-in that asked for it rather than to one replayed from somewhere else.
 */
export async function verifyIdToken(idToken: string, nonce: string): Promise<GoogleIdentity | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  let header: { alg?: string; kid?: string };
  let claims: {
    iss?: string;
    aud?: string;
    exp?: number;
    nonce?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as typeof header;
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as typeof claims;
  } catch {
    return null;
  }

  // The algorithm is pinned. Accepting whatever the header asks for is the classic way a
  // signature check is turned off, so 'none' and HMAC-signed tokens cannot get through.
  if (header.alg !== 'RS256' || !header.kid) return null;

  const key = (await googleSigningKeys()).get(header.kid);
  if (!key) return null;

  const signatureOk = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    key,
    Buffer.from(sigB64, 'base64url')
  );
  if (!signatureOk) return null;

  if (!claims.iss || !ISSUERS.includes(claims.iss)) return null;
  if (claims.aud !== googleClientId()) return null;
  if (!claims.exp || claims.exp * 1000 <= Date.now()) return null;
  if (claims.nonce !== nonce) return null;
  if (!claims.sub) return null;

  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 40) : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

/* ── the signup ticket: carries a verified Google identity through the ordinary form ────── */

export type GoogleTicket = {
  purpose: 'google-signup';
  sub: string;
  email: string | null;
  name: string | null;
  exp: number;
};

/**
 * Hand a verified Google identity to the signup form without trusting the browser with it.
 *
 * The browser only ever holds the signature, so an identity cannot be invented client-side: a
 * forged ticket fails the HMAC and a stale one fails the expiry. This is what lets registration
 * attach Google without Google having to create the account itself, which is what keeps the
 * phone block on the one path that already enforces it.
 */
export function signGoogleTicket(identity: {
  sub: string;
  email: string | null;
  name: string | null;
}): string {
  const payload: GoogleTicket = {
    purpose: 'google-signup',
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    exp: Date.now() + TICKET_MS,
  };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyGoogleTicket(token: string | undefined | null): GoogleTicket | null {
  const opened = openSigned<GoogleTicket>(token);
  if (!opened || opened.payload.purpose !== 'google-signup') return null;
  if (!opened.payload.sub) return null;
  return opened.payload;
}
