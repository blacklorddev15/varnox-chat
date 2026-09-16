import { currentUser } from '@/lib/auth';
import { botMediaFor } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Serves a picture the bot sent into a thread.
 *
 * Stricter than /api/media/<id>, and deliberately so. Ordinary chat media is public to anyone
 * holding the URL, because ids are 24 random characters and the chat UI points <img> straight
 * at them. Bot media cannot work that way: it is stored by content hash and shared between
 * every thread that received the same bytes, so the id is neither random nor secret — a
 * sequence number anyone could walk through.
 *
 * So this route checks the signed-in account instead, and checks permission by reference: you
 * may fetch a picture only if one of your own bot replies points at it. That is what makes
 * sharing the row safe — a menu image is the same picture for everybody who was sent it, so
 * having the row tells nobody anything they did not already have.
 *
 * 404 for "not yours" and "does not exist" alike, so the two are indistinguishable. The cache
 * is private for the same reason: the response depends on who asked.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Response('Not found', { status: 404 });
  }

  const viewer = await currentUser();
  if (!viewer) return new Response('Not found', { status: 404 });

  const media = await botMediaFor(numeric, viewer.id);
  if (!media) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.mime,
      'Content-Length': String(media.bytes.length),
      // Immutable because the content is addressed by its hash: the same id can never hold a
      // different picture. Private because access depends on who is asking.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
