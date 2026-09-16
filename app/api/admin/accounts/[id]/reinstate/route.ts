import { requireAdmin } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { reinstateAccount } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lift a suspension, putting the account back exactly as it was.
 *
 * Nothing has to be restored, because nothing was taken: suspension only ever set a timestamp,
 * so clearing it is the whole of the undo. The account can sign in again on its next request —
 * `isAccountSuspended` is a direct query, not a cached one, so there is no window where it is
 * still refused.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;

    const done = await reinstateAccount(id);
    // A 409 rather than a silent success: an admin who reinstates an account that was not
    // suspended has done nothing, and should be told so rather than shown a confirmation.
    if (!done) return bad('That account is not suspended', 409);

    return ok({ suspension: null });
  });
}
