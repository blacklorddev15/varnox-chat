import { requireAdmin } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listAccountsForAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The owner's account list.
 *
 * This is the only place a review request is discoverable. The account asks from its banner and
 * the request is recorded on its row, so without listing suspended accounts there would be no
 * way to learn that somebody had asked — the request would be written and never read.
 *
 * Ordered by the database, with requests first: this screen exists to answer people, so the
 * people waiting are at the top.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const only = new URL(req.url).searchParams.get('only') === 'suspended' ? 'suspended' : 'all';
    const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    return ok({ accounts: await listAccountsForAdmin(only, limit) });
  });
}
