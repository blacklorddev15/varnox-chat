import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { botRateMessage, botRateSlot, getBot } from '@/lib/bots';
import {
  MESSAGES_PER_READ,
  MESSAGE_MAX,
  getBotThread,
  listBotMessages,
  sendBotThreadMessage,
} from '@/lib/bot-chat';
import { str, validate } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** The conversation with one bot: its state, the thread, and the messages oldest-first. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    const bot = await getBot(me.id, id);
    if (!bot) return bad('Bot not found', 404);

    return ok({
      bot,
      thread: await getBotThread(me.id, id),
      messages: await listBotMessages(me.id, id, MESSAGES_PER_READ),
    });
  });
}

const SendSchema = { body: str({ label: 'Message', min: 1, max: MESSAGE_MAX }) };

/**
 * Say something to one of your bots.
 *
 * 409 when there is no thread, which is the one case a person can act on: the fix is to press START
 * first. Answering 201 with a message the bot will never receive would be the alternative, and it
 * would be a lie.
 *
 * Validated rather than truncated. A message is content — a caller who sends more than the limit
 * should be told, not have their message quietly halved on the way in.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const id = clean((await ctx.params).id, 80);
    if (!id) return bad('Which bot?');

    const bot = await getBot(me.id, id);
    if (!bot) return bad('Bot not found', 404);

    const input = validate(SendSchema, await readJsonBody<unknown>(req));

    const slot = await botRateSlot(me.id, 'mutate');
    if (!slot.allowed) return bad(botRateMessage('mutate', slot.retryAfterMs), 429);

    const message = await sendBotThreadMessage(me.id, id, input.body);
    if (!message) return bad('That bot has not been started yet. Press Start first.', 409);

    return ok({ message }, 201);
  });
}
