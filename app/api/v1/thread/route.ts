import { handle, ok } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { MESSAGES_PER_READ, listBotMessages } from '@/lib/bot-chat';

export const dynamic = 'force-dynamic';

/**
 * The conversation, for context.
 *
 * The inbox hands over individual messages, which is enough to answer one but not enough to answer
 * it well — a bot that cannot see what it said a moment ago will repeat itself. This is the same
 * read the account's own screen does, scoped to the token's owner, so the bot sees exactly what the
 * person sees.
 *
 * Reading here does not claim anything and does not mark anything answered. It is a read.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    return ok({ messages: await listBotMessages(auth.ownerId, auth.bot.id, MESSAGES_PER_READ) });
  });
}
