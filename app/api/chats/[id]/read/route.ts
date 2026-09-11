import { requireUser } from '@/lib/auth';
import { bad, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getSettings, markRead } from '@/lib/db';

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

    // Users who hide their read receipts still get their own unread badge cleared,
    // but no visible receipt is published for others.
    const settings = await getSettings(me.id);
    const stamped = Math.min(at, Date.now());
    await markRead(me.id, id, stamped, { shareReceipt: settings.privacy.readReceipts });
    return ok({ read: true, at: stamped, shared: settings.privacy.readReceipts });
  });
}
