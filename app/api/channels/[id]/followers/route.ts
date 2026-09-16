import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getChannel, getChannelFollowers } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Who follows one of your channels — the number in the header is public, the names are not.
 *
 * The ownership check is here and again inside the query, because this is the one endpoint
 * that can name a channel's audience. "Forbidden" is thrown rather than returned so the
 * shared handler maps it to a 403.
 */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const channel = await getChannel(id, me.id);
    if (!channel) throw new Error('Channel not found');
    if (!channel.isOwner) {
      throw new Error('Forbidden: only the channel owner can see its followers');
    }

    return ok({ followers: await getChannelFollowers(id, me.id) });
  });
}
