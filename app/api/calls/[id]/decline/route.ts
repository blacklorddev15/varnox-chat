import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { declineCall } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Refuse a ringing call. The receiver only, and only while it is still ringing. */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    return ok({ call: await declineCall(id, me.id) });
  });
}
