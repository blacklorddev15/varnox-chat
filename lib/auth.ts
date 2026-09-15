import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { SessionPayload, User, PublicUser } from './types';
import { getUser } from './db';

const COOKIE = 'varnox_session';
const SECRET = process.env.SESSION_SECRET || 'varnox-local-dev-secret';
const MAX_AGE = 60 * 60 * 24 * 30;

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

export function signSession(uid: string, days = 30): string {
  const payload: SessionPayload = { uid, exp: Date.now() + days * 86_400_000 };
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

export async function setSessionCookie(uid: string) {
  const jar = await cookies();
  jar.set(COOKIE, signSession(uid), {
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

/** Resolve the signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const payload = verifySession(jar.get(COOKIE)?.value);
  if (!payload) return null;
  return getUser(payload.uid);
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    phone: u.phone ?? null,
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
