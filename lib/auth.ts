import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { SessionPayload, User, PublicUser } from './types';
import { getUser, isAccountDeleted, isDeviceActive } from './db';

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

/** Server-sent session identity used by the API routes. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
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
