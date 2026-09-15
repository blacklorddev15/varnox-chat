/**
 * Phone login by one-time code — the flow a mainstream messenger uses.
 *
 * The number is the identity and the code is the proof: nothing is sent until a code
 * comes back. That is a real change from the password-only scheme, where a number was
 * a login ID that nobody had to own.
 *
 * What protects it:
 *  - the code is never stored, only an HMAC of it keyed by the server secret with the
 *    number mixed in, so a database leak yields no usable codes and a code seen for one
 *    number cannot be replayed against another;
 *  - codes expire, are single-use, and die after a handful of wrong guesses, which is
 *    what makes a six-digit space safe;
 *  - every send is throttled per number and per IP, because each one costs money at the
 *    provider and an unthrottled endpoint is a way to bill someone else's account.
 */

import crypto from 'node:crypto';
import { claimOtpAttempt, clearOtp, consumeOtp, getOtp, putOtp, takeRateSlot } from './db';
import { formatPhone, phoneKey } from './phone';
import { sendLoginCode } from './sms';

/** A code is good for ten minutes, then a new one has to be requested. */
export const OTP_TTL_MS = 10 * 60_000;
/** How long the client waits before offering "resend". */
export const OTP_RESEND_MS = 60_000;
/** Wrong guesses allowed against a single code before it is thrown away. */
export const OTP_MAX_ATTEMPTS = 5;

// Sends, per number and per IP. Deliberately tight: legitimate use is one or two.
const SEND_PER_NUMBER = { windowMs: 15 * 60_000, limit: 3 };
const SEND_PER_IP = { windowMs: 60 * 60_000, limit: 10 };

/**
 * The key the code hash is built on.
 *
 * In production it must come from the environment. Falling back to the literal below would
 * mean hashes are keyed by a value that sits in the repository, so a database leak alone
 * would be enough to recover live codes offline — the opposite of what hashing them is
 * for. Failing closed is the better outcome.
 */
function pepper(): string {
  const configured = process.env.SMS_CODE_PEPPER || process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMS_CODE_PEPPER or SESSION_SECRET must be set to hash login codes');
  }
  return 'varnox-local-dev-secret';
}

/** "45 seconds" / "12 minutes" — a throttle message that says when to come back. */
function waitText(ms: number): string {
  if (ms < 90_000) return `${Math.max(1, Math.ceil(ms / 1000))} seconds`;
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

/** Six digits from a CSPRNG — never Math.random, which is not unpredictable enough here. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(phone: string, code: string): string {
  return crypto
    .createHmac('sha256', pepper())
    .update(`${phoneKey(phone)}:${code}`)
    .digest('hex');
}

/** Constant-time comparison, so a wrong guess cannot be narrowed down by timing. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export type StartOtpResult =
  | { ok: true; to: string; expiresInSec: number; resendInSec: number }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

/**
 * Send a code to a number.
 *
 * The reply is deliberately the same whether or not the number has an account: telling
 * a stranger which numbers are registered would hand them the user list. Whether the
 * account is new is only revealed after the code is verified.
 */
export async function startOtp(phone: string, ip: string | null): Promise<StartOtpResult> {
  const now = Date.now();

  // The resend timer first, so a double tap does not look like an attack to the other
  // buckets, then the hourly caps.
  const cooldown = await takeRateSlot(`cooldown:phone:${phoneKey(phone)}`, OTP_RESEND_MS, 1, now);
  if (!cooldown.allowed) {
    return {
      ok: false,
      status: 429,
      error: `A code was just sent. You can ask for another in ${waitText(cooldown.retryAfterMs)}.`,
      retryAfterSec: Math.ceil(cooldown.retryAfterMs / 1000),
    };
  }

  const perNumber = await takeRateSlot(
    `send:phone:${phoneKey(phone)}`,
    SEND_PER_NUMBER.windowMs,
    SEND_PER_NUMBER.limit,
    now
  );
  if (!perNumber.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Too many codes requested for this number. Try again in ${waitText(perNumber.retryAfterMs)}.`,
      retryAfterSec: Math.ceil(perNumber.retryAfterMs / 1000),
    };
  }

  // A shared bucket when no address is available, rather than skipping the check: the
  // header is client-controllable, so "absent" must not be the way around the limit.
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
  await putOtp({
    phone,
    codeHash: hashCode(phone, code),
    sentAt: now,
    expiresAt: now + OTP_TTL_MS,
    ip,
  });

  // Derive the minutes from the constant rather than repeating it, so the message can never
  // claim a different expiry from the one the row actually has.
  const sent = await sendLoginCode(phone, code, Math.round(OTP_TTL_MS / 60_000));
  if (!sent.ok) {
    // Leave no code behind: a send that failed must not leave a valid code the caller
    // was never told about.
    await clearOtp(phone);
    return { ok: false, status: 502, error: sent.error ?? 'We could not send the code.' };
  }

  return {
    ok: true,
    to: formatPhone(phone),
    expiresInSec: Math.round(OTP_TTL_MS / 1000),
    resendInSec: Math.round(OTP_RESEND_MS / 1000),
  };
}

export type VerifyOtpResult =
  /** `codeHash` identifies the exact code that was consumed, so a failed sign-in can hand
   *  that one back without touching a newer code that replaced it in the meantime. */
  | { ok: true; codeHash: string }
  | { ok: false; status: number; error: string; reissue?: boolean };

/** Check a code. On success it is consumed, so the same code cannot be used twice. */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const now = Date.now();
  const row = await getOtp(phone);

  if (!row) {
    return { ok: false, status: 400, error: 'Request a new code.', reissue: true };
  }
  if (row.consumedAt !== null) {
    return { ok: false, status: 400, error: 'That code has already been used. Request a new one.', reissue: true };
  }
  if (row.expiresAt <= now) {
    await clearOtp(phone);
    return { ok: false, status: 400, error: 'That code has expired. Request a new one.', reissue: true };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await clearOtp(phone);
    return {
      ok: false,
      status: 429,
      error: 'Too many wrong codes. Request a new one.',
      reissue: true,
    };
  }

  // Spend a guess before comparing, atomically. Reading the row, deciding, and only then
  // writing would let a concurrent burst each see the same count and all be hashed, so a
  // single code could absorb far more than the allowance and the six-digit space would
  // stop being safe.
  const spent = await claimOtpAttempt(phone, now, OTP_MAX_ATTEMPTS);
  if (spent === null) {
    return {
      ok: false,
      status: 429,
      error: 'That code can no longer be used. Request a new one.',
      reissue: true,
    };
  }

  if (!sameHash(hashCode(phone, code), row.codeHash)) {
    const left = Math.max(0, OTP_MAX_ATTEMPTS - spent);
    if (left === 0) {
      await clearOtp(phone);
      return { ok: false, status: 429, error: 'Too many wrong codes. Request a new one.', reissue: true };
    }
    return {
      ok: false,
      status: 400,
      error: `That code is not right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
    };
  }

  // Exactly one caller can claim the code, so the same correct code cannot mint two
  // sessions even if it arrives twice at once.
  const claimed = await consumeOtp(phone);
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
