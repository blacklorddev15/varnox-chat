import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getChannel, markChannelRead } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark everything in one channel as read, which is what clears its unread dot.
 *
 * Opening the channel is the only thing that calls this, so the mark moves to now rather
 * than to the newest post: a post that lands while the channel is open is on screen anyway.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const channel = await getChannel(id, me.id);
    if (!channel) throw new Error('Channel not found');

    await markChannelRead(id, me.id);
    return ok({ read: true });
  });
}
