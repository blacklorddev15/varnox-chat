import { handle, ok } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { INBOX_BATCH, claimBotInbox } from '@/lib/bot-chat';

export const dynamic = 'force-dynamic';

/**
 * Give the serverless function room for a long poll.
 *
 * A `wait` that outlives the platform's function limit gets the request killed mid-flight — the
 * client sees a 504 and, worse, cannot tell it apart from the service being down. The cap below is
 * set inside this budget with margin, and a client whose poll comes back empty simply asks again.
 * That is the property that makes the long poll safe to lose: it is an optimisation, not a
 * mechanism. A bot that only ever short-polls is slower and still correct.
 */
export const maxDuration = 30;

/** The longest a single poll will hold for. */
const MAX_WAIT_MS = 25_000;

/** How often the wait re-checks the queue. */
const POLL_EVERY_MS = 1_500;

function waitFrom(value: string | null): number {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Math.round(seconds * 1000), MAX_WAIT_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The bot's queue: take the oldest pending messages and mark them taken.
 *
 * `wait` turns this into a long poll — the request holds the connection open until something
 * arrives or the wait runs out, so the bot answers in about a second instead of on its next tick.
 * Without it the call returns immediately with whatever is there, which is what a bot that would
 * rather loop on its own schedule should use.
 *
 * Claiming is the reason this is a GET that changes state, which is unusual and deliberate: the
 * handler is not fetching a representation, it is taking work, and work cannot be taken by reading.
 * The alternative — a GET that only reads plus a POST that claims — would need the bot to make two
 * calls and would reintroduce the race the claim exists to close.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    const wait = waitFrom(new URL(req.url).searchParams.get('wait'));
    const deadline = Date.now() + wait;

    let messages = await claimBotInbox(auth.bot.id, auth.ownerId, INBOX_BATCH);
    while (messages.length === 0 && Date.now() < deadline) {
      await sleep(Math.min(POLL_EVERY_MS, Math.max(0, deadline - Date.now())));
      messages = await claimBotInbox(auth.bot.id, auth.ownerId, INBOX_BATCH);
    }

    return ok({ messages, waited: wait });
  });
}

/** Exported for the README, so the documented ceiling and the enforced one cannot drift. */
export const INBOX_LIMITS = { batch: INBOX_BATCH, maxWaitMs: MAX_WAIT_MS } as const;
