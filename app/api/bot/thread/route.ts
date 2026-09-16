import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok } from '@/lib/api';
import { listBotThread } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * One number's bot thread: what was typed here, and what came back, in a single list.
 *
 * Scoped by the signed-in user inside the query, so a session id belonging to somebody else
 * reads as an empty thread rather than as theirs. Nothing needs to be checked first — which is
 * the point, because a check that has to be remembered is one that eventually is not.
 *
 * Polled by the screen while it is open. There is deliberately no streaming here: the bridge
 * answers on the order of a second, and a poll that returns a whole small thread is far less
 * machinery than a socket the app would then have to keep alive on a phone.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();

    const session = clean(new URL(req.url).searchParams.get('session'), 80);
    if (!session) return bad('Which number? Pass ?session=<id>.');

    return ok({ thread: await listBotThread(me.id, session) });
  });
}
