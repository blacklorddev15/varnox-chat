import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { getConv, getTyping, setTyping } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await getConv(id);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    await setTyping(id, me.id);
    const typing = (await getTyping(id)).filter((uid) => uid !== me.id);
    return ok({ typing });
  });
}
