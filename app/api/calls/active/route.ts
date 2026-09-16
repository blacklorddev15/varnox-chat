import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getLiveCall } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The user's live call, or null.
 *
 * One endpoint drives both call surfaces: the incoming-call screen while the other party is
 * the caller, and the in-call screen once it is answered. So it has to be cheap — it is polled
 * about once a second while a call is up — and it has to carry the peer, because the screen
 * that draws it has nothing else to work from.
 *
 * A ringing call that nobody answered is not live: the 45 second window is part of the read,
 * so this simply goes back to null and the ringing screen is taken away.
 */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ call: await getLiveCall(me.id) });
  });
}
