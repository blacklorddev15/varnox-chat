import { bad, handle, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { claimMessageView, getConv, getMessage } from '@/lib/db';
import { MEDIA_TOKEN_TTL_MS, mediaToken } from '@/lib/media';

export const dynamic = 'force-dynamic';

/**
 * POST /api/messages/<id>/open — open a view-once attachment, once.
 *
 * This is the gate. It records the view *before* handing back a URL, and the media route
 * will not serve once-media without a token from here, so the "once" is a property of the
 * data rather than a rule the UI politely follows.
 *
 * The view is claimed with a conditional insert, so two taps arriving together cannot both
 * be told they were first. What this does not and cannot prevent: a screenshot, or someone
 * photographing the screen. "View once" is about replay, not about making content
 * unrecordable, and it would be dishonest to imply otherwise.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const message = await getMessage(id);
    if (!message) return bad('Message not found', 404);
    if (!message.once) return bad('That message is not a view-once message', 400);
    if (!message.mediaUrl) return bad('That message has no attachment', 400);
    if (message.senderId === me.id) {
      return bad('You sent this attachment, so it cannot be opened here', 403);
    }

    const conv = await getConv(message.convId);
    if (!conv || !conv.members.includes(me.id)) return bad('Message not found', 404);

    const claimed = await claimMessageView(message.id, me.id);
    if (!claimed) return bad('This attachment has already been opened', 409);

    // The stored URL is "/api/media/<id>.<ext>"; the route keys on the part before the dot.
    const mediaId = (message.mediaUrl.split('/').pop() ?? '').split('.')[0];
    if (!/^[a-z0-9]{8,64}$/.test(mediaId)) return bad('That attachment is missing', 404);

    return ok({
      url: `/api/media/${mediaId}?t=${mediaToken(mediaId, me.id)}`,
      mime: message.mime ?? null,
      type: message.type,
      expiresInSec: Math.round(MEDIA_TOKEN_TTL_MS / 1000),
    });
  });
}
