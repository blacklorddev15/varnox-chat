import crypto from 'node:crypto';
import { q } from './pg';
import { rand } from './ids';

/**
 * Blob storage for images, voice notes and files.
 *
 * This used to be Vercel Blob. The store got suspended on the Hobby plan for exceeding
 * its operation limit, so media now lives in Postgres as bytea and is served back
 * through /api/media/<id>.
 *
 * Size is not a concern at this scale: the client downscales images before upload
 * (max 1600px, JPEG q0.82) and the upload route rejects anything over 4 MB.
 *
 * Some media is marked *once*: a view-once photo or voice note. That flag is enforced in
 * the serving route, not here — see app/api/media/[id]/route.ts — because a flag that only
 * the client respects is decoration: the URL in a chat payload would still be a permanent
 * link to the bytes.
 */

export type StoredMedia = { id: string; url: string; size: number; mime: string; once: boolean };

export type LoadedMedia = { id: string; mime: string; bytes: Buffer; once: boolean };

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
};

export async function saveMedia(bytes: Buffer, mime: string, once = false): Promise<StoredMedia> {
  const id = rand(24);
  await q(
    'insert into vx_media (id, mime, bytes, size, created_at, once) values ($1, $2, $3, $4, $5, $6)',
    [id, mime, bytes, bytes.length, Date.now(), once]
  );
  return { id, url: `/api/media/${id}`, size: bytes.length, mime, once };
}

/**
 * Look up media by id.
 *
 * The id can carry an extension (`<id>.jpg`) so the browser sees a sensible filename;
 * only the part before the dot identifies the row.
 */
export async function getMedia(idWithExt: string): Promise<LoadedMedia | null> {
  const id = idWithExt.split('.')[0];
  if (!/^[a-z0-9]{8,64}$/.test(id)) return null;
  const rows = await q<{ mime: string; bytes: Buffer; once: boolean }>(
    'select mime, bytes, once from vx_media where id = $1',
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return { id, mime: row.mime, bytes: row.bytes, once: Boolean(row.once) };
}

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime] ?? (mime.split('/')[1] || 'bin').split(';')[0].slice(0, 8);
}

/**
 * How long a view-once URL stays usable after the view is recorded.
 *
 * Long enough for a slow connection to fetch the bytes that the tap already earned, short
 * enough that a copied URL is worthless a minute later. It cannot be zero: the URL has to
 * survive the round trip that displays it.
 */
export const MEDIA_TOKEN_TTL_MS = 2 * 60_000;

function tokenSecret(): string {
  return process.env.SESSION_SECRET || 'varnox-local-dev-secret';
}

/**
 * Mint a token for one viewer and one media id.
 *
 * Bound to both, so a token handed to one person cannot be used by another, and an expired
 * one is refused without a lookup. The clock is part of the signed payload rather than a
 * separate field a caller could edit.
 */
export function mediaToken(mediaId: string, userId: string, now = Date.now()): string {
  const expiresAt = now + MEDIA_TOKEN_TTL_MS;
  const signature = crypto
    .createHmac('sha256', tokenSecret())
    .update(`${mediaId}:${userId}:${expiresAt}`)
    .digest('hex')
    .slice(0, 32);
  return `${expiresAt}.${signature}`;
}

export function verifyMediaToken(
  mediaId: string,
  userId: string,
  token: string,
  now = Date.now()
): boolean {
  const [expiresRaw, signature] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!expiresAt || !signature || expiresAt < now) return false;

  const expected = crypto
    .createHmac('sha256', tokenSecret())
    .update(`${mediaId}:${userId}:${expiresAt}`)
    .digest('hex')
    .slice(0, 32);

  const given = Buffer.from(signature, 'hex');
  const want = Buffer.from(expected, 'hex');
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
