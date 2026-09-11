import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { createInvite, getConv } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Create (or return) an invite link for a group. */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await getConv(id);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);
    if (conv.type !== 'group') return bad('Only groups have invite links');

    const invite = await createInvite(conv.id, me.id);
    return ok({ invite, path: `/join/${invite.code}` });
  });
}
