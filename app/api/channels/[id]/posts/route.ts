import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { createChannelPost, getChannel, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Long enough for a real announcement, short enough to stay a post rather than an essay. */
const MAX_TEXT = 1000;
const KINDS = ['text', 'image'] as const;

/** Posting is capped per account, in a bucket of its own. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 60;

/**
 * Post to a channel. The owner is the only one who may — that is the whole point of a
 * broadcast, so it is refused here and again inside the insert statement.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ kind?: string; text?: string; mediaUrl?: string }>(req);

    const kind = KINDS.find((k) => k === body.kind);
    if (!kind) return bad('A post must be text or a photo');

    // Validate the payload before spending a rate slot: a malformed request should not cost
    // a caller one of their posts.
    const text = clean(body.text, MAX_TEXT);
    const mediaUrl = clean(body.mediaUrl, 600);
    if (kind === 'text' && !text) return bad('Write something for your channel');
    if (kind === 'image' && !mediaUrl) return bad('A photo post needs an image');

    // Here for the error a caller can act on; createChannelPost enforces it again in the
    // statement, which is what actually makes it true.
    const channel = await getChannel(id, me.id);
    if (!channel) throw new Error('Channel not found');
    if (!channel.isOwner) throw new Error('Forbidden: only the channel owner can post');

    const slot = await takeRateSlot(`channel-post:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const minutes = Math.ceil(slot.retryAfterMs / 60_000);
      return bad(`You have posted too many times. Try again in ${minutes} min.`, 429);
    }

    const post = await createChannelPost(id, me.id, {
      kind,
      // A photo post may carry a caption in the same field a text post puts its body in.
      text: text || null,
      mediaUrl: kind === 'image' ? mediaUrl : null,
    });
    return ok({ post }, 201);
  });
}
