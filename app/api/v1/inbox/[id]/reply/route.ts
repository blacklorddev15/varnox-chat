import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { MESSAGE_MAX, replyToBotMessage } from '@/lib/bot-chat';
import { str, validate } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ReplySchema = { body: str({ label: 'Reply', min: 1, max: MESSAGE_MAX }) };

/**
 * Answer one of the messages this bot claimed.
 *
 * 409 for every way this can fail — no such message, somebody else's, already answered, never
 * claimed — with one sentence, for the same reason the token guard gives one refusal: a bot that
 * could tell those apart could use the difference to learn about messages it was not given. The
 * legitimate client's next move is the same in all four cases, which is to claim work and answer
 * what it claimed.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which message?');

    const input = validate(ReplySchema, await readJsonBody<unknown>(req));

    const reply = await replyToBotMessage(auth.bot.id, auth.ownerId, id, input.body);
    if (!reply) {
      return bad(
        'That is not a message this bot has claimed, or it has already been answered. Claim it with GET /api/v1/inbox first.',
        409
      );
    }

    return ok({ message: reply }, 201);
  });
}
