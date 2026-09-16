import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { acceptCall } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pick up a ringing call. Only the receiver can, and only while it is still ringing and still
 * inside the 45 second window — both are conditions of the update itself, so a second tap on a
 * stale screen changes nothing and is told so.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    return ok({ call: await acceptCall(id, me.id) });
  });
}
