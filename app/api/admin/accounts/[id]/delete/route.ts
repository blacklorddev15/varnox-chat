import { requireAdmin } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { deleteAccount, getUser, recordAdminAction } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
type Body = { username?: string };

/**
 * Delete an account, as the owner.
 *
 * This is the capability that did not exist at all: `app/api/account/delete` takes its id from
 * the session cookie, so it can only ever reach the account that is signed in. Removing somebody
 * else's account previously required a database console.
 *
 * It reuses `deleteAccount` deliberately, which means the same confirmation as the self-service
 * path: the target's handle has to be typed, and the check is the database's, not this route's.
 * An admin is more powerful than an ordinary account but no more able to delete the wrong row by
 * accident — and the account a mistyped id would hit is somebody else's.
 *
 * Soft, exactly as before. Messages stay in the threads they were sent to, because they are not
 * only this account's to remove.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await readJsonBody<Body>(req);

    // The self-service route, not this one, is where an admin deletes their own account — and it
    // asks for a password-confirmed session path. Doing it here would make the owner's own
    // deletion a single typing mistake away.
    if (id === admin.id) return bad('Use your own account settings to delete your account', 409);

    const typed = clean(body.username, 40);
    if (!typed) return bad("Type the account's username to confirm");

    // Read before deleting, so the audit row names the account as it was. The row survives a soft
    // delete, but the name is what makes the entry readable years later, and reading it first
    // means the entry cannot depend on that staying true.
    const target = await getUser(id);

    const done = await deleteAccount(id, typed);
    // One answer for a wrong username and an already-deleted account, so neither can be probed.
    if (!done) return bad('That does not match their username', 403);

    await recordAdminAction({
      actor: admin,
      action: 'delete',
      targetId: id,
      // `typed` is the fallback and not a guess: deleteAccount only returned true because it
      // matched this account's username.
      targetName: target ? target.displayName || target.username : typed,
      detail: null,
    });

    return ok({ deleted: true });
  });
}
