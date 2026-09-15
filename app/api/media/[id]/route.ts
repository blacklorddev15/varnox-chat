import { getMedia } from '@/lib/media';

export const dynamic = 'force-dynamic';

/**
 * Serves an uploaded image, voice note or file.
 *
 * Media is public to anyone holding the URL, which matches how the previous Vercel Blob
 * store behaved (public access) and what the chat UI expects: <img src> and download
 * links point straight at it. Ids are 24 random characters, so they are not guessable.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const media = await getMedia(id);
  if (!media) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.mime,
      'Content-Length': String(media.bytes.length),
      // Immutable: an id is written once and never overwritten.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
