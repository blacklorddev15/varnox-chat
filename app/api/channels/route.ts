import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { createChannel, listDiscoverableChannels, listMyChannels, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** A name has to fit one row of a list; the description has room for the rest. */
const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;

/**
 * Creating a channel is capped per account, in its own bucket so a run of channel creation
 * cannot exhaust the OTP, sign-in or status limits (and the other way round).
 */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 10;

/** The channels the signed-in user follows, or with ?discover=1 the ones they do not. */
export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const discover = new URL(req.url).searchParams.get('discover') === '1';
    const channels = discover
      ? await listDiscoverableChannels(me.id)
      : await listMyChannels(me.id);
    return ok({ channels });
  });
}

type Body = {
  name?: string;
  description?: string;
  avatar?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);

    // A name of 61 characters cleans to 61, so asking for one more than the limit is how the
    // overflow is detected — the caller is told rather than silently truncated.
    const name = clean(body.name, MAX_NAME + 1);
    if (!name) return bad('Give your channel a name');
    if (name.length > MAX_NAME) {
      return bad(`A channel name can be at most ${MAX_NAME} characters`);
    }

    // Validate before spending a rate slot: a malformed request should not cost a caller one
    // of their ten channels.
    const slot = await takeRateSlot(`channel:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const minutes = Math.ceil(slot.retryAfterMs / 60_000);
      return bad(`You have created too many channels. Try again in ${minutes} min.`, 429);
    }

    const channel = await createChannel(me.id, {
      name,
      description: clean(body.description, MAX_DESCRIPTION) || null,
      avatar: clean(body.avatar, 600) || null,
    });
    return ok({ channel }, 201);
  });
}
