import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { SessionPayload, User, PublicUser } from './types';
import { getUser, isAccountDeleted, isAccountSuspended, isDeviceActive } from './db';

const COOKIE = 'varnox_session';
const SECRET = process.env.SESSION_SECRET || 'varnox-local-dev-secret';
const SESSION_DAYS = 30;
const MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = (stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signSession(uid: string, days = SESSION_DAYS, did?: string): string {
  const payload: SessionPayload = { uid, exp: Date.now() + days * 86_400_000 };
  // The device id rides in the cookie rather than in a second cookie or a lookup: a session
  // then knows which device it belongs to, which is what makes revoking one possible.
  if (did) payload.did = did;
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (!payload.uid || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(uid: string, did?: string) {
  const jar = await cookies();
  jar.set(COOKIE, signSession(uid, SESSION_DAYS, did), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/**
 * The device this request's session was issued to, when it carries one.
 *
 * A cookie minted before devices existed has no id, and neither does one signed in with a
 * password or a phone code, so callers have to cope with null.
 */
export async function currentDeviceId(): Promise<string | null> {
  const jar = await cookies();
  const payload = verifySession(jar.get(COOKIE)?.value);
  return payload?.did ?? null;
}

/**
 * Resolve the signed-in user, or null.
 *
 * A cookie stays cryptographically valid after its device is signed out from somewhere else,
 * so a session that names a device is checked against that device's row as well — cached for
 * a few seconds, because this runs on every authenticated request. Sessions without a device
 * id are exactly what they always were and are not second-guessed.
 */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const payload = verifySession(jar.get(COOKIE)?.value);
  if (!payload) return null;
  if (payload.did && !(await isDeviceActive(payload.did))) return null;
  const user = await getUser(payload.uid);
  if (!user) return null;
  // A deleted account is signed out of everything at once, and this is the one place that makes
  // it so: every authenticated route reaches the database through requireUser, which reaches
  // this. Checking here means deletion cannot be half-applied by a route that forgot to look.
  if (await isAccountDeleted(user.id)) return null;
  return user;
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    phone: u.phone ?? null,
    email: u.email ?? null,
    displayName: u.displayName,
    about: u.about,
    avatar: u.avatar,
    lastSeen: u.lastSeen,
  };
}

/** Derive a stable-looking handle for accounts that register with only a phone number. */
export function handleFromPhone(phone: string): string {
  return `vx${phone.replace(/[^\d]/g, '').slice(-8)}`;
}

/**
 * Server-sent session identity used by the API routes.
 *
 * A suspended account is refused here rather than in `currentUser`, and the difference matters.
 * `currentUser` has to keep resolving a suspended account, because that is what lets the banner
 * be drawn at all: returning null would sign the account out and show the sign-in screen, which
 * looks like a broken app, and would leave no session to prove identity with when the account
 * asks for a review.
 *
 * Every authenticated route reaches the database through this function, so refusing here closes
 * all of them at once — the same argument the deletion check makes, one layer up.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  if (await isAccountSuspended(user.id)) throw new SuspendedError();
  return user;
}

/**
 * The owner's own accounts, named by handle, for the admin routes.
 *
 * An environment variable rather than a column, for the reason mayReadSmsInbox gives: a column
 * can be granted by anything that can write to the table, so it is not a boundary, whereas this
 * is only reachable by somebody who can already redeploy the app.
 *
 * Fails closed. If the variable is unset or empty, nobody is an admin — a missing configuration
 * must not hand the power to everyone, and the alternative default (the first account, the
 * oldest account) is a guess that would be wrong in exactly the situation nobody is watching.
 */
export function adminUsernames(): string[] {
  return (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  const allowed = adminUsernames();
  return allowed.length > 0 && allowed.includes(user.username.toLowerCase());
}

/** An admin route's identity check. Re-read from the session; never from the request body. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new ForbiddenError();
  // The allowlist says which account may be an admin. The password is a second, independent
  // check for the person holding that account — a phone left unlocked in a pocket should not be
  // enough to delete somebody's account. Both must pass.
  if (!(await adminUnlocked())) throw new ForbiddenError();
  return user;
}

/* ── the admin password ────────────────────────────────────────────────────── */

/**
 * The admin password's scrypt hash, from the environment.
 *
 * A hash in an env var rather than a literal in the code, and this is the security decision in
 * the whole feature. A literal would live in a public repository — readable by anyone — and it
 * would grant suspend and delete over every account on the platform. A value in a browser bundle
 * would be worse still: not even a repository needed. An env var is only reachable by somebody
 * who can already redeploy the app, and a hash means reading it does not hand over the password.
 *
 * Generate it with the same function that hashes account passwords, so the format cannot drift:
 *   node -e "console.log(require('crypto').scryptSync(process.argv[1], require('crypto').randomBytes(16).toString('hex'), 64).toString('hex'))" 'your password'
 * then wrap it as scrypt$salt$hash — or simply reuse hashPassword() from a script.
 */
export function adminPasswordHash(): string {
  return (process.env.ADMIN_PASSWORD_HASH || '').trim();
}

/**
 * Whether a password is required on top of the allowlist.
 *
 * Unset means the allowlist is the only gate, which is already a real boundary — that is how the
 * admin routes shipped. Leaving it unset must not lock the owner out of their own routes, and
 * must not silently mean "no password required, so allow": the allowlist still applies.
 */
export function adminPasswordRequired(): boolean {
  return adminPasswordHash().length > 0;
}

/**
 * Check a password against the stored hash.
 *
 * Returns false when no hash is configured rather than true. An empty password must never be a
 * way through: if this returned true whenever the variable was missing, clearing the variable
 * would be a way to skip the check.
 */
export function checkAdminPassword(password: string): boolean {
  const stored = adminPasswordHash();
  if (!stored) return false;
  return verifyPassword(password, stored);
}

/**
 * How long an unlocked admin session lasts.
 *
 * Short on purpose. The point of the password is that the account being signed in is not by
 * itself enough, so the proof should expire while the person is still nearby — not last as long
 * as the session cookie does.
 */
const ADMIN_UNLOCK_MS = 30 * 60_000;

export const ADMIN_COOKIE = 'vx_admin';

/**
 * Proof that the admin password was entered, as a signed cookie.
 *
 * Purpose-bound rather than a session: `verifySession` requires a uid and this payload has none,
 * so an unlock token can never be accepted as a signed-in session. And `verifyAdminUnlock`
 * requires the purpose below, so a session token can never be accepted as an unlock. The two are
 * not interchangeable in either direction, which is the property that matters.
 */
export function signAdminUnlock(): string {
  const body = b64u(
    Buffer.from(JSON.stringify({ purpose: 'admin', exp: Date.now() + ADMIN_UNLOCK_MS }))
  );
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyAdminUnlock(token: string | undefined | null): boolean {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  const expected = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      purpose?: string;
      exp?: number;
    };
    return payload.purpose === 'admin' && typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/** True when the admin gate is satisfied: no password configured, or an unexpired unlock. */
export async function adminUnlocked(): Promise<boolean> {
  if (!adminPasswordRequired()) return true;
  const jar = await cookies();
  return verifyAdminUnlock(jar.get(ADMIN_COOKIE)?.value);
}

export async function setAdminUnlockCookie() {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, signAdminUnlock(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ADMIN_UNLOCK_MS / 1000),
  });
}

export async function clearAdminUnlockCookie() {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden');
  }
}

/**
 * Thrown for an account that is suspended, so a 403 can say which state it is in.
 *
 * Deliberately not an UnauthorizedError: the two lead to different screens. Unauthorized means
 * sign in again; suspended means the account is locked out and may ask for a review. Collapsing
 * them would send a suspended account round a sign-in loop it can never leave.
 */
export class SuspendedError extends Error {
  constructor() {
    super('suspended');
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}
/**
 * The hash stored for an account that signs in with a phone code and has no password.
 *
 * It is not a well-formed scrypt tuple, so verifyPassword() can never match it. That is
 * the point: password login stays unavailable for the account until the user sets one,
 * rather than being reachable with an empty or guessable password.
 */
export function passwordlessHash(): string {
  return 'otp$disabled';
}
