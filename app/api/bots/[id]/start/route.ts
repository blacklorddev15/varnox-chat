import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok } from '@/lib/api';
import { botRateMessage, botRateSlot, getBot } from '@/lib/bots';
import { startBotThread } from '@/lib/bot-chat';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * START: open the conversation with one of your bots.
 *
 * Idempotent, and honest about it — the response says whether this was the press that created the
 * thread or one that found it already there. That distinction is what lets the screen say "started"
 * once and "open" afterwards without guessing, and it means a double-tap cannot produce two
 * greetings.
 *
 * Ownership is checked before anything happens, so another account's bot id is a 404 here exactly
 * as it is everywhere else in this namespace.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    const bot = await getBot(me.id, id);
    if (!bot) return bad('Bot not found', 404);

    const slot = await botRateSlot(me.id, 'mutate');
    if (!slot.allowed) return bad(botRateMessage('mutate', slot.retryAfterMs), 429);

    return ok({ started: true, ...(await startBotThread(me.id, id)) });
  });
}
