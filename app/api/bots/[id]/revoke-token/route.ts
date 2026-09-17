import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok } from '@/lib/api';
import { botRateMessage, botRateSlot, getBot, revokeBotToken } from '@/lib/bots';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Withdraw the bot's Varnox API token.
 *
 * A POST rather than a DELETE, and a sub-resource rather than a field on the bot, because the
 * token is not the bot: the bot stays, its name and its Telegram link stay, and only the
 * credential stops working. Modelling it as `DELETE /api/bots/[id]/token` would suggest the token
 * is a thing that can be re-created by writing one, and there is deliberately no such route —
 * see the note at the end of this file.
 *
 * The id is checked before anything is revoked, so a nonexistent bot and another account's bot
 * are both a plain 404 rather than a success that changes nothing.
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

    /**
     * Only a live token can be revoked, and `revokeBotToken` reports whether one was. Answering
     * 200 to a bot whose token was already revoked would tell the caller a credential had just
     * been withdrawn when nothing had changed — and in a security action, a UI that reports
     * success it did not have is worse than one that reports nothing.
     *
     * It is not an error either: the caller's intent ("this token must not work") is satisfied.
     * So 200 with `revoked: false`, which lets the screen say "already revoked" rather than
     * inventing a failure.
     */
    const revoked = await revokeBotToken(me.id, id);
    return ok({ revoked, id });
  });
}

/**
 * There is deliberately no route that issues a second token.
 *
 * One bot, one token, issued at creation. A re-issue endpoint would add a second way to obtain a
 * credential, a second place to get the "show it once" logic wrong, and a question the current
 * design does not have to answer — whether the previous token survives a re-issue. An account
 * that has revoked a token and wants a working bot again creates the bot again, which is one
 * obvious operation with no ambiguity about what the old token does afterwards: it is gone with
 * the row that held its hash.
 */
