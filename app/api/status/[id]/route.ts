import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { deleteStatus, getStatus } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Remove one of your own updates before its 24 hours are up. */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const status = await getStatus(id, me.id);
    if (!status) throw new Error('Status not found');
    if (status.userId !== me.id) throw new Error('Forbidden: that update is not yours');

    await deleteStatus(id, me.id);
    return ok({ deleted: true });
  });
}
