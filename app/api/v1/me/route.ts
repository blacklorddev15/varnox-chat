import { handle, ok } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { getUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Who this token is.
 *
 * The endpoint to call first, and the one that answers "does my token work". It exists so that a
 * client can fail immediately and legibly — with a 401 from here rather than a confusing error
 * from an endpoint that also tried to do something — and so that an operator debugging an
 * integration can separate "the credential is wrong" from "the credential is fine and the request
 * was wrong".
 *
 * It mirrors what OAuth calls a userinfo endpoint, with one deliberate difference: the owner is
 * identified by their public username only. A bot that acts for an account does not need the
 * account's email or phone number to do it, and a token that leaks should not turn into a contact
 * list.
 *
 * The bot's own description and Telegram identity are included because they are what a client
 * shows a human when it reports what it is connected as.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    /**
     * The owner, as its public username and nothing else. Read through getUser() rather than
     * carried on the token, so the answer reflects an account that was renamed or soft-deleted
     * after the token was minted — and so a token for an account that has since gone answers with
     * a null owner instead of a name that no longer exists.
     */
    const owner = await getUser(auth.ownerId);

    return ok({
      owner: owner ? { username: owner.username, displayName: owner.displayName } : null,
      bot: {
        id: auth.bot.id,
        handle: auth.bot.handle,
        name: auth.bot.name,
        description: auth.bot.description,
        active: auth.bot.active,
        createdAt: auth.bot.createdAt,
        telegram: {
          linked: auth.bot.hasTelegram,
          botId: auth.bot.telegramBotId,
          username: auth.bot.telegramUsername,
          checkedAt: auth.bot.telegramCheckedAt,
        },
        token: {
          issuedAt: auth.bot.tokenIssuedAt,
          revokedAt: auth.bot.tokenRevokedAt,
        },
      },
    });
  });
}
