import { NextResponse } from 'next/server';
import { UnauthorizedError } from './auth';
import { ensureSchema } from './migrate';

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
    const message = err instanceof Error ? err.message : 'Server error';
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
