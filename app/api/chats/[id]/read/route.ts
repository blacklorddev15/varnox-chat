import { requireUser } from '@/lib/auth';
import { bad, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, markRead } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await getConv(id);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    let at = Date.now();
    try {
      const body = await readJsonBody<{ at?: number }>(req);
      if (body?.at && Number.isFinite(Number(body.at))) at = Number(body.at);
    } catch {
      /* empty body is fine */
    }
    await markRead(me.id, id, Math.min(at, Date.now()));
    return ok({ read: true, at });
  });
}
