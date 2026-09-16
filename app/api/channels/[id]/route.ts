import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getChannel, listChannelPosts } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * One channel and its posts, for a follower or its owner.
 *
 * Anyone else gets the same 404 as a channel that does not exist: membership of a channel is
 * the reader's business, and a 403 here would confirm that a given id is real.
 */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const channel = await getChannel(id, me.id);
    if (!channel) throw new Error('Channel not found');

    const posts = await listChannelPosts(id, me.id);
    return ok({ channel, posts });
  });
}
