import { NextResponse } from 'next/server';
import { SuspendedError, UnauthorizedError } from './auth';
import { ensureSchema } from './migrate';
import { ValidationError } from './validate';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Postgres error codes that mean the *database* is behind the code, not that the caller did
 * anything wrong: 42703 is an unknown column, 42P01 an unknown table.
 *
 * Without this, a forgotten migration shows up as a scatter of unrelated-looking 500s — a
 * display picture that will not save, a signup that fails, an email login that errors — and
 * each one looks like a separate bug in a different feature.
 */
function schemaDrift(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42703' || code === '42P01';
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  // Reconcile the schema before serving (a no-op once this process has done it). Without
  // this, a deploy that lands ahead of its migration produces a scatter of 500s that each
  // look like an unrelated bug.
  await ensureSchema();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnauthorizedError) return bad('Not signed in', 401);
    // Answered before the generic branches below, because the message would otherwise fall
    // through to a 500 and read as a broken server rather than a deliberate lockout. The status
    // and the wording are what let the client show the banner instead of an error toast.
    if (err instanceof SuspendedError) return bad('This account is suspended', 403);
    /**
     * A body that failed its schema is the caller's mistake, not the server's, so it is answered
     * before the generic branches below.
     *
     * Without this it fell through to 500: the ValidationError's message is a sentence about a
     * field ("Bot name is required."), which matches none of the wording tests below. A 500 there
     * is not merely the wrong number — it tells the client to retry and tells the operator to
     * look at the server log, when the person who can fix it is the one who typed the form.
     */
    if (err instanceof ValidationError) return bad(err.message, 400);
    // The same argument for a body that is not JSON at all. readJsonBody() throws a plain Error
    // whose message is the whole body of information available, so this is matched on the
    // wording; it is the only such test here that is not backed by an error class.
    const message = err instanceof Error ? err.message : 'Server error';
    if (message === 'Invalid JSON body') return bad(message, 400);
    console.error('[varnox]', message);
    if (schemaDrift(err)) {
      console.error('[varnox] schema drift — the database is missing an object this code expects');
      return bad('This server needs a database migration. Run: npm run db:apply', 503);
    }
    if (/already taken/i.test(message)) return bad(message, 409);
    if (/not found/i.test(message)) return bad(message, 404);
    if (/forbidden/i.test(message)) return bad(message, 403);
    return bad(message, 500);
  }
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function clean(text: unknown, max = 4000): string {
  return String(text ?? '').replace(/\u0000/g, '').slice(0, max).trim();
}

/**
 * Best-effort client address, used only to label a row in the user's own device list —
 * never an authorisation decision, so a spoofed value costs the caller nothing but a
 * misleading label on their own screen.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 60);
  }
  return req.headers.get('x-real-ip')?.trim().slice(0, 60) ?? null;
}

export function userAgent(req: Request): string | null {
  return clean(req.headers.get('user-agent'), 200) || null;
}

/**
 * A short, human label for a device — "Chrome on Android" rather than a user-agent string,
 * because the device list is meant to be scanned to spot the one that is not yours.
 */
export function deviceLabel(req: Request): string {
  const ua = req.headers.get('user-agent') ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}
