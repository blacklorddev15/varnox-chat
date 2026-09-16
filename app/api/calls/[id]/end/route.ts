import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { endCall } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Hang up, from either end. Idempotent in effect: the call is over after the first one, and a
 * second request gets the call back rather than an error, because both screens tear themselves
 * down on their own schedule and either of them may send this.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    return ok({ call: await endCall(id, me.id) });
  });
}
