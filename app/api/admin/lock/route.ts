import { clearAdminUnlockCookie, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Lock the admin controls again.
 *
 * Uses `requireUser` rather than `requireAdmin`: an admin whose unlock has already expired must
 * still be able to press the lock button, and refusing on the way out would be absurd. Clearing
 * a cookie the caller already cannot use needs no permission beyond being signed in.
 *
 * Worth having because the unlock lasts half an hour. Somebody who is finished should not have to
 * rely on that expiring, and on a shared or borrowed device they may not be able to sign out
 * without losing the session they still need.
 */
export async function POST() {
  return handle(async () => {
    await requireUser();
    await clearAdminUnlockCookie();
    return ok({ locked: true });
  });
}
