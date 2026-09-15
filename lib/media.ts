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
 */

export type StoredMedia = { id: string; url: string; size: number; mime: string };

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

export async function saveMedia(bytes: Buffer, mime: string): Promise<StoredMedia> {
  const id = rand(24);
  await q('insert into vx_media (id, mime, bytes, size, created_at) values ($1, $2, $3, $4, $5)', [
    id,
    mime,
    bytes,
    bytes.length,
    Date.now(),
  ]);
  return { id, url: `/api/media/${id}`, size: bytes.length, mime };
}

/**
 * Look up media by id.
 *
 * The id can carry an extension (`<id>.jpg`) so the browser sees a sensible filename;
 * only the part before the dot identifies the row.
 */
export async function getMedia(
  idWithExt: string
): Promise<{ mime: string; bytes: Buffer } | null> {
  const id = idWithExt.split('.')[0];
  if (!/^[a-z0-9]{8,64}$/.test(id)) return null;
  const rows = await q<{ mime: string; bytes: Buffer }>(
    'select mime, bytes from vx_media where id = $1',
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return { mime: row.mime, bytes: row.bytes };
}

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime] ?? (mime.split('/')[1] || 'bin').split(';')[0].slice(0, 8);
}
