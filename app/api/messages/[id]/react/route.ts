import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getReactions, putReaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED = new Set([
  '👍', '❤️', '😂', '😮', '😢', '🙏',
  '😍', '🔥', '👏', '🎉', '✅', '💯',
]);

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ convId?: string; emoji?: string }>(req);
    const convId = clean(body.convId, 60);
    const emoji = clean(body.emoji, 8);
    if (!convId) return bad('Missing conversation');
    if (emoji && !ALLOWED.has(emoji)) return bad('Unsupported reaction');

    const conv = await getConv(convId);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    await putReaction({ convId, msgId: id, userId: me.id, emoji, at: Date.now() });
    const reactions = await getReactions(convId);
    return ok({ reactions, msgId: id, emoji });
  });
}
