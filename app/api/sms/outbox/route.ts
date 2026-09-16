import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listSmsOutbox } from '@/lib/db';
import { mayReadSmsInbox } from '@/lib/sms';

export const dynamic = 'force-dynamic';

/**
 * The dev SMS inbox: what a login code would have been texted as.
 *
 * This route hands out live login codes, so it is the most sensitive thing in the app — more
 * than the admin surfaces, because a code is a complete account takeover of somebody else's
 * account rather than an action taken as you. Two conditions, both required:
 *
 *   1. `SMS_DEV_MODE` is on. That is also the condition under which the inbox is *written*, so
 *      the two cannot drift: the feature is visible exactly where it is populated.
 *   2. The signed-in account is named in `SMS_INBOX_USERNAMES`.
 *
 * An environment allowlist rather than a flag on the user row, and that is deliberate. A
 * database column can be granted by anything that can write to the database — a bug in another
 * route, a leaked connection string, a careless migration — and granting it would hand over
 * every login code on the platform. An environment variable cannot be set from a query.
 *
 * When either condition fails this answers `available: false` with no rows at all, rather than
 * an error. The screen uses that to decide whether to draw the link, and a caller who is not
 * allowed learns only that the feature exists — never a code, never a number.
 */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    // One predicate, defined and tested in lib/sms.ts, rather than the rule being re-stated
    // here where it would be reachable only with a session.
    if (!mayReadSmsInbox(me.username)) return ok({ available: false });
    return ok({ available: true, messages: await listSmsOutbox(50) });
  });
}
