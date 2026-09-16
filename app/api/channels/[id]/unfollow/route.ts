import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { unfollowChannel } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Leave a channel.
 *
 * An owner is refused rather than quietly ignored: a channel nobody owns could never be
 * posted to again, and there would be no way back in. "Forbidden" is thrown rather than
 * returned so the shared handler maps it to a 403.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const removed = await unfollowChannel(id, me.id);
    return ok({ following: false, removed });
  });
}
