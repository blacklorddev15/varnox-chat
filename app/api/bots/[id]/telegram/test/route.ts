import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok } from '@/lib/api';
import {
  botRateMessage,
  botRateSlot,
  botTelegramToken,
  getBot,
  recordTelegramCheck,
} from '@/lib/bots';
import { telegramGetMe } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Ask the Telegram Bot API server who this bot is.
 *
 * This is the whole of the Telegram integration: getMe, on demand, from the server. Nothing here
 * registers a webhook, sends a message or moves a bot between servers, so pressing this button
 * cannot leave a bot in a different state than it was found in — which matters, because it is the
 * button somebody presses while unsure whether their token is right.
 *
 * WHERE THE TOKEN LIVES, IN ORDER
 *
 *  - In `vx_bots.telegram_secret`, sealed. The column has never held the plaintext.
 *  - Decrypted in memory here, by botTelegramToken(), for the length of one request.
 *  - Put into the request path by lib/telegram.ts, which is the only place it becomes a string.
 *  - Not in the response. The reply describes the bot — id, username, first name — and the token
 *    is not among the fields it returns, not even partially. Nothing is redacted out of a
 *    response that carried it, because the simplest way to be sure a secret is not in a payload
 *    is for the payload never to have held it.
 *  - Not in a log. The failure paths in lib/telegram.ts discard the underlying error precisely
 *    because a fetch error quotes the URL, and the URL contains it.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    // Ownership first, so another account's bot id is a 404 before anything is decrypted and
    // before a rate slot is spent.
    const bot = await getBot(me.id, id);
    if (!bot) return bad('Bot not found', 404);

    if (!bot.hasTelegram) {
      return bad(
        'This bot has no Telegram token saved, so there is nothing to test. Create a bot with a token to use this.',
        400
      );
    }

    const slot = await botRateSlot(me.id, 'test');
    if (!slot.allowed) return bad(botRateMessage('test', slot.retryAfterMs), 429);

    const token = await botTelegramToken(me.id, id);
    if (!token) {
      /**
       * A token is on file but will not open, which means the key that sealed it is not the key
       * available now — SESSION_SECRET or TELEGRAM_TOKEN_KEY was rotated since it was saved.
       *
       * A distinct 409 and a message that says what to do, rather than a 500. The stored value is
       * not corrupt and the database is not broken: something the operator did, on purpose,
       * invalidated it, and the only move that fixes it is to save the token again. Saying so is
       * the difference between a five-second fix and a bug report.
       */
      return bad(
        'The saved Telegram token can no longer be read, because the key that encrypted it has changed since it was saved. Create the bot again with the token.',
        409
      );
    }

    const outcome = await telegramGetMe(token);

    if (!outcome.ok) {
      /**
       * A refusal from Telegram clears the recorded identity; a failure to reach the server does
       * not.
       *
       * The distinction is what makes the stored id and username trustworthy. If Telegram
       * answered and said no, then whatever is on screen about this token is now known to be
       * wrong and must go. If the bot API server could not be reached, nothing was learned about
       * the token at all — erasing a correct answer because the network was down would be
       * throwing away the last thing anybody knew, and would make a recorded identity vanish for
       * a reason that had nothing to do with it.
       *
       * 400 is the status lib/telegram.ts uses for "Telegram considered the token and rejected
       * it", as opposed to 502 and 503 for a server or configuration problem.
       */
      if (outcome.status === 400) await recordTelegramCheck(me.id, id, null);
      return bad(outcome.error, outcome.status);
    }

    await recordTelegramCheck(me.id, id, { id: outcome.bot.id, username: outcome.bot.username });

    return ok({
      ok: true,
      bot: { id: outcome.bot.id, username: outcome.bot.username, firstName: outcome.bot.firstName },
      checkedAt: Date.now(),
    });
  });
}
