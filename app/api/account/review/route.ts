import { currentUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { getSuspension, requestReview } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Ask for a suspension to be looked at.
 *
 * This is the one route that must use `currentUser()` rather than `requireUser()`, and the
 * reason is not subtle: `requireUser()` refuses a suspended account, so requiring it here would
 * mean the only accounts able to ask about a suspension are accounts that are not suspended.
 *
 * The id comes from the session and never from the body, so an account can ask about itself and
 * nothing else. The database checks the suspension too, so this cannot be used as a flag any
 * signed-in account sets on itself at will.
 *
 * Idempotent by design. Pressing the button a second time is not an error, and the recorded time
 * stays at the first request rather than sliding forward — otherwise a person could ask daily and
 * put themselves permanently at the top of the review queue.
 */
export async function POST() {
  return handle(async () => {
    const me = await currentUser();
    if (!me) return bad('Not signed in', 401);

    const before = await getSuspension(me.id);
    if (!before) return bad('This account is not suspended', 409);

    if (!before.reviewRequestedAt) await requestReview(me.id);

    // Read back rather than echo what was sent, so the client shows what is stored.
    return ok({ suspension: await getSuspension(me.id) });
  });
}
