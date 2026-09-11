import { NextResponse } from 'next/server';
import { UnauthorizedError } from './auth';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnauthorizedError) return bad('Not signed in', 401);
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[varnox]', message);
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
