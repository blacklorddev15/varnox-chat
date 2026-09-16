import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { getStatus, markStatusSeen } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Record that the caller opened one update.
 *
 * Your own update is refused rather than ignored: a self-view would put you in your own
 * "viewed by" list, which is meaningless and would make the count wrong.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const status = await getStatus(id, me.id);
    if (!status) throw new Error('Status not found');
    if (status.userId === me.id) return bad('You cannot view your own update', 403);

    await markStatusSeen(id, me.id);
    return ok({ seen: true });
  });
}
