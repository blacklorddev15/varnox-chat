import { currentUser } from '@/lib/auth';
import { getMedia, verifyMediaToken } from '@/lib/media';

export const dynamic = 'force-dynamic';

/**
 * Serves an uploaded image, voice note or file.
 *
 * Ordinary media is public to anyone holding the URL, which matches how the previous Vercel
 * Blob store behaved (public access) and what the chat UI expects: <img src> and download
 * links point straight at it. Ids are 24 random characters, so they are not guessable.
 *
 * Media marked *once* is the exception. A view-once photo or voice note is only view-once
 * if the bytes cannot be fetched again, and a URL in a chat payload would otherwise be a
 * permanent link — so this route refuses that media unless the request carries a token
 * minted for that viewer by POST /api/messages/<id>/open, which is also what records the
 * view. Without that, "view once" would be a label the UI draws rather than a property of
 * the data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const media = await getMedia(id);
  if (!media) return new Response('Not found', { status: 404 });

  if (media.once) {
    const token = new URL(req.url).searchParams.get('t') ?? '';
    const viewer = await currentUser();
    if (!viewer || !verifyMediaToken(media.id, viewer.id, token)) {
      return new Response('This attachment can only be opened once, from the chat', {
        status: 403,
      });
    }
  }

  return new Response(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.mime,
      'Content-Length': String(media.bytes.length),
      // Immutable only for ordinary media: an id is written once and never overwritten.
      // Once-media must not sit in any cache, or the "once" outlives the token.
      'Cache-Control': media.once
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
    },
  });
}
