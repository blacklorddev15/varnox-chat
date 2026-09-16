import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { followChannel } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Follow a channel.
 *
 * Idempotent, so the button in the discover sheet can be tapped twice without the audience
 * going up twice. Following your own channel is harmless and writes nothing new.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    await followChannel(id, me.id);
    return ok({ following: true });
  });
}
