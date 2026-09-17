import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok } from '@/lib/api';
import { botRateMessage, botRateSlot, deleteBot, getBot } from '@/lib/bots';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** One bot, including its token state but never its tokens. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    // Null covers "no such bot" and "not this account's bot" with the same answer, so the two
    // are indistinguishable to the caller and a bot id cannot be used to probe for existence.
    const bot = await getBot(me.id, id);
    if (!bot) return bad('Bot not found', 404);
    return ok({ bot });
  });
}

/**
 * Delete a bot and the tokens issued to it.
 *
 * A real delete rather than a soft one, unlike an account. The reasoning that makes account
 * deletion soft — messages belong to threads shared with other people, so removing the rows would
 * reach into data the account was only half of — does not apply here: a bot's tokens are the
 * account's own, nothing else in the app references a bot, and leaving a row behind would leave
 * a credential record nobody can see or revoke. Deleting is the honest operation.
 *
 * Scoped by owner inside the statement (see deleteBot), so another account's bot id deletes
 * nothing and reads as absent.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    const slot = await botRateSlot(me.id, 'mutate');
    if (!slot.allowed) return bad(botRateMessage('mutate', slot.retryAfterMs), 429);

    const deleted = await deleteBot(me.id, id);
    if (!deleted) return bad('Bot not found', 404);
    return ok({ deleted: true, id });
  });
}
