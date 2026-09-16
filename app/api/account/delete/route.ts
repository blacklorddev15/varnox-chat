import { clearSessionCookie, requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { deleteAccount } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Delete the account.
 *
 * Confirmed by typing the handle rather than by tapping twice, because this is irreversible from
 * the app and takes the account's whole history out of reach. The check is the database's —
 * `deleteAccount` refuses unless the string matches — so a client that skips the prompt gains
 * nothing.
 *
 * Soft: the row stays and messages stay in the threads they were sent to. They are not only
 * this account's to remove, and erasing them would reach into everybody else's copy of the
 * conversation. What goes away is the ability to sign in and any appearance in search.
 */
type Body = { username?: string };

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const typed = clean(body.username, 40);
    if (!typed) return bad('Type your username to confirm');

    const done = await deleteAccount(me.id, typed);
    // One answer for "wrong username" and "already deleted", so neither can be probed.
    if (!done) return bad('That does not match your username', 403);

    // Signing out is not a courtesy. The cookie is still cryptographically valid, and leaving it
    // would keep somebody signed in to an account they have just deleted.
    await clearSessionCookie();
    return ok({ deleted: true });
  });
}
