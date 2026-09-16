import { requireAdmin } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getSuspension, getUser, recordAdminAction, suspendAccount } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
type Body = { reason?: string };

/**
 * Suspend an account.
 *
 * The caller is re-read from the session on every request — `requireAdmin()` — and never taken
 * from the body. A role claimed in a request is a parameter, not a permission.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await readJsonBody<Body>(req);

    // Refusing this is not politeness. Suspending yourself would leave the app with no account
    // able to lift the suspension, and there is only ever one owner configured — so a single
    // mistyped id would lock the only person who could undo it out of the product.
    if (id === admin.id) return bad('You cannot suspend your own account', 409);

    // Recorded, not required. A suspension with no note still works; it just explains less to
    // the person who is about to read it.
    const reason = clean(body.reason, 280) || null;

    const done = await suspendAccount(id, reason);
    if (!done) return bad('No such account, or it has been deleted', 404);

    // Written after the write, never before. A row claiming an action that did not happen is
    // worse than no row at all, because it is the record anybody would consult to find out what
    // really happened — and it would be wrong in the one direction nobody thinks to doubt.
    const target = await getUser(id);
    await recordAdminAction({
      actor: admin,
      action: 'suspend',
      targetId: id,
      targetName: target ? target.displayName || target.username : id,
      detail: reason,
    });

    return ok({ suspension: await getSuspension(id) });
  });
}
