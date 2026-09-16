import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { listWhatsAppSessions, sendBotMessage, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The bot, driven from inside the app.
 *
 * GET  — which numbers this account can talk to.
 * POST — send a message to one of them.
 *
 * Neither of these reaches the bot. A message is written to varnox_bot_inbound and the bot's
 * bridge helper on the host picks it up; the answer arrives in varnox_bot_outbound and is read
 * by the thread route. The app has no route to the host and the host has no route into the app,
 * which is the whole point: there is no inbound surface here for a bundle that ships shell
 * access to reach.
 *
 * The numbers are the same ones the pairing screen lists, and deliberately so — a thread is
 * only meaningful for a number that actually got as far as 'connected'.
 */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ numbers: await listWhatsAppSessions(me.id) });
  });
}

type Body = { session?: string; body?: string };

/**
 * Queue one message for the bot.
 *
 * Capped per account in its own bucket, so a run of bot messages cannot exhaust the pairing,
 * OTP or sign-in limits — and so a loop in the client cannot fill the bot's queue with work it
 * then has to answer one message at a time.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const input = await readJsonBody<Body>(req);

    const session = clean(input.session, 80);
    const body = clean(input.body, 4000);

    if (!session) return bad('Choose a number to send to.');
    if (!body) return bad('Type a message first.');

    const slot = await takeRateSlot(`bot:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const minutes = Math.ceil(slot.retryAfterMs / 60_000);
      return bad(`Too many messages. Try again in ${minutes} min.`, 429);
    }

    const sent = await sendBotMessage(me.id, session, body);
    // Null covers "no such number" and "not this account's number" alike, so the two are
    // indistinguishable to the caller.
    if (!sent) return bad('That number is not linked to this account', 404);

    return ok({ message: sent }, 201);
  });
}
