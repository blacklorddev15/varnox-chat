import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getStatus, listStatusViewers } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Who watched one of your own updates.
 *
 * The ownership check is here and again inside the query, because this is the one endpoint
 * that can name the people who looked at somebody's post: a non-author must never reach it.
 * "Forbidden" is thrown rather than returned so the shared handler maps it to a 403.
 */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const status = await getStatus(id, me.id);
    if (!status) throw new Error('Status not found');
    if (status.userId !== me.id) throw new Error('Forbidden: only the author can see who viewed');

    return ok({ viewers: await listStatusViewers(id, me.id) });
  });
}
