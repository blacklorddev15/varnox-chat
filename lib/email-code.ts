/**
 * Confirming an email address by one-time code.
 *
 * The address is the thing being proved and the code is the proof. Unlike the phone flow in
 * lib/otp.ts this is not a sign-in path: the route that accepts a code reads the address from
 * the session rather than from the request, so a code can only ever confirm an address its
 * holder is already signed in as.
 *
 * What protects it is borrowed wholesale from lib/otp.ts, because the problem is the same shape:
 *  - the code is never stored, only an HMAC of it keyed by the server secret with the address
 *    mixed in, so a database leak yields no usable codes and a code observed for one address
 *    cannot be replayed against another;
 *  - codes expire, are single-use, and die after a handful of wrong guesses, which is what makes
 *    a six-digit space safe;
 *  - every send is throttled per address and per IP, because each one costs money at the
 *    provider and an unthrottled endpoint is a way to bill someone else's account.
 *
 * Deliberately absent: any notion of a blocked address. A phone number is blocked as anti-abuse
 * for the login channel, and lib/otp.ts checks that at both the send and the verify step. An
 * address has no such concept here, and inventing one would mean a second place to get the
 * "what does a blocked subject see" answer subtly wrong. If email ever becomes a sign-in path
 * that changes, and the check belongs here with it.
 */

import crypto from 'node:crypto';
import {
  claimEmailCodeAttempt,
  clearEmailCode,
  consumeEmailCode,
  getEmailCode,
  putEmailCode,
  takeRateSlot,
} from './db';
import { normaliseEmail } from './email';
import { sendEmailCode } from './mail';
// The generator is the same six digits from a CSPRNG. Taken from lib/otp.ts rather than written
// again so the two cannot drift: this one is security-relevant, and a second copy is a second
// chance to reach for Math.random.
import { generateCode } from './otp';

/** A code is good for ten minutes, then a new one has to be requested. */
export const EMAIL_CODE_TTL_MS = 10 * 60_000;
/** How long the client waits before offering "resend". */
export const EMAIL_CODE_RESEND_MS = 60_000;
/** Wrong guesses allowed against a single code before it is thrown away. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

// Sends, per address and per IP. Deliberately tight: legitimate use is one or two.
const SEND_PER_ADDRESS = { windowMs: 15 * 60_000, limit: 3 };
const SEND_PER_IP = { windowMs: 60 * 60_000, limit: 10 };

/**
 * The key the code hash is built on.
 *
 * EMAIL_CODE_PEPPER comes first so a deployment can scope this secret, then the same chain
 * lib/otp.ts uses. Sharing a key between the two is safe because the subject is mixed into the
 * hash, so a phone code and an address code can never collide.
 *
 * In production it must come from the environment. Falling back to the literal below would mean
 * hashes are keyed by a value sitting in the repository, so a database leak alone would be enough
 * to recover live codes offline — the opposite of what hashing them is for. Failing closed is
 * the better outcome.
 */
function pepper(): string {
  const configured =
    process.env.EMAIL_CODE_PEPPER || process.env.SMS_CODE_PEPPER || process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_CODE_PEPPER or SESSION_SECRET must be set to hash confirmation codes');
  }
  return 'varnox-local-dev-secret';
}

/** "45 seconds" / "12 minutes" — a throttle message that says when to come back. */
function waitText(ms: number): string {
  if (ms < 90_000) return `${Math.max(1, Math.ceil(ms / 1000))} seconds`;
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

function hashCode(email: string, code: string): string {
  return crypto.createHmac('sha256', pepper()).update(`${email}:${code}`).digest('hex');
}

/** Constant-time comparison, so a wrong guess cannot be narrowed down by timing. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export type StartEmailCodeResult =
  | { ok: true; to: string; expiresInSec: number; resendInSec: number }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

/**
 * Send a code to an address.
 *
 * The caller is expected to be the signed-in owner of that address, so unlike the phone version
 * there is nothing to hide about whether it exists: the reply carries the canonical address back
 * so the screen can show exactly where the mail went.
 *
 * The address is normalised here rather than trusted from the caller. A row written under a
 * non-canonical spelling could never be found again, and the failure would look like a wrong
 * code rather than a bad key.
 */
export async function startEmailCode(
  email: string,
  ip: string | null
): Promise<StartEmailCodeResult> {
  const to = normaliseEmail(email);
  if (!to) return { ok: false, status: 400, error: 'That is not a valid email address.' };

  const now = Date.now();

  // The resend timer first, so a double tap does not look like an attack to the other buckets,
  // then the hourly caps. Same order, and the same reason, as lib/otp.ts.
  const cooldown = await takeRateSlot(`cooldown:email:${to}`, EMAIL_CODE_RESEND_MS, 1, now);
  if (!cooldown.allowed) {
    return {
      ok: false,
      status: 429,
      error: `A code was just sent. You can ask for another in ${waitText(cooldown.retryAfterMs)}.`,
      retryAfterSec: Math.ceil(cooldown.retryAfterMs / 1000),
    };
  }

  const perAddress = await takeRateSlot(
    `send:email:${to}`,
    SEND_PER_ADDRESS.windowMs,
    SEND_PER_ADDRESS.limit,
    now
  );
  if (!perAddress.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Too many codes requested for this address. Try again in ${waitText(perAddress.retryAfterMs)}.`,
      retryAfterSec: Math.ceil(perAddress.retryAfterMs / 1000),
    };
  }

  // The IP bucket is shared with the SMS sender, and that is intended: it is one budget for one
  // connection, and splitting it per channel would give an attacker a fresh allowance simply by
  // alternating which form they abuse. A shared bucket when no address is available, rather than
  // skipping the check, because the header is client-controllable and "absent" must not be the
  // way around the limit.
  const perIp = await takeRateSlot(
    `send:ip:${ip ?? 'unknown'}`,
    SEND_PER_IP.windowMs,
    SEND_PER_IP.limit,
    now
  );
  if (!perIp.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Too many codes requested from this connection. Try again in ${waitText(perIp.retryAfterMs)}.`,
      retryAfterSec: Math.ceil(perIp.retryAfterMs / 1000),
    };
  }

  const code = generateCode();
  await putEmailCode({
    email: to,
    codeHash: hashCode(to, code),
    sentAt: now,
    expiresAt: now + EMAIL_CODE_TTL_MS,
    ip,
  });

  // Derive the minutes from the constant rather than repeating it, so the message can never
  // claim a different expiry from the one the row actually has.
  const sent = await sendEmailCode(to, code, Math.round(EMAIL_CODE_TTL_MS / 60_000));
  if (!sent.ok) {
    // Leave no code behind: a send that failed must not leave a valid code the caller was never
    // told about.
    await clearEmailCode(to);
    // The provider's own wording is passed through where the module has it, because a first-run
    // failure is usually a setup problem — an unverified sending domain, most often — and
    // "we could not send the code" sends the operator looking in the wrong place.
    return { ok: false, status: 502, error: sent.error ?? 'We could not send the code.' };
  }

  return {
    ok: true,
    to,
    expiresInSec: Math.round(EMAIL_CODE_TTL_MS / 1000),
    resendInSec: Math.round(EMAIL_CODE_RESEND_MS / 1000),
  };
}

export type VerifyEmailCodeResult =
  /** `codeHash` identifies the exact code that was consumed, for the same reason as otp.ts: a
   *  later failure can hand that one back without touching a newer code that replaced it. */
  | { ok: true; codeHash: string }
  | { ok: false; status: number; error: string; reissue?: boolean };

/** Check a code. On success it is consumed, so the same code cannot be used twice. */
export async function verifyEmailCode(
  email: string,
  code: string
): Promise<VerifyEmailCodeResult> {
  const to = normaliseEmail(email);
  if (!to) return { ok: false, status: 400, error: 'That is not a valid email address.' };

  const now = Date.now();
  const row = await getEmailCode(to);

  if (!row) {
    return { ok: false, status: 400, error: 'Request a new code.', reissue: true };
  }
  if (row.consumedAt !== null) {
    return {
      ok: false,
      status: 400,
      error: 'That code has already been used. Request a new one.',
      reissue: true,
    };
  }
  if (row.expiresAt <= now) {
    await clearEmailCode(to);
    return { ok: false, status: 400, error: 'That code has expired. Request a new one.', reissue: true };
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await clearEmailCode(to);
    return {
      ok: false,
      status: 429,
      error: 'Too many wrong codes. Request a new one.',
      reissue: true,
    };
  }

  // Spend a guess before comparing, atomically. Reading the row, deciding, and only then writing
  // would let a concurrent burst each see the same count and all be hashed, so a single code
  // could absorb far more than the allowance and the six-digit space would stop being safe.
  const spent = await claimEmailCodeAttempt(to, now, EMAIL_CODE_MAX_ATTEMPTS);
  if (spent === null) {
    return {
      ok: false,
      status: 429,
      error: 'That code can no longer be used. Request a new one.',
      reissue: true,
    };
  }

  if (!sameHash(hashCode(to, code), row.codeHash)) {
    const left = Math.max(0, EMAIL_CODE_MAX_ATTEMPTS - spent);
    if (left === 0) {
      await clearEmailCode(to);
      return { ok: false, status: 429, error: 'Too many wrong codes. Request a new one.', reissue: true };
    }
    return {
      ok: false,
      status: 400,
      error: `That code is not right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
    };
  }

  // Exactly one caller can claim the code, so the same correct code cannot be spent twice even
  // if it arrives twice at once.
  const claimed = await consumeEmailCode(to);
  if (!claimed) {
    return {
      ok: false,
      status: 400,
      error: 'That code has already been used. Request a new one.',
      reissue: true,
    };
  }
  return { ok: true, codeHash: row.codeHash };
}
