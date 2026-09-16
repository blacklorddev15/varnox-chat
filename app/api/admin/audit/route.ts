import { requireAdmin } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listAdminAudit } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * What the owner has done, newest first.
 *
 * A log nobody can read is not accountability, so it is served rather than merely written. It
 * answers the one question that previously had no answer: which account did this, and when.
 *
 * Read-only on purpose. There is no route to edit or delete an entry — a record that can be
 * tidied up by the person it incriminates is not a record.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    return ok({ entries: await listAdminAudit(limit) });
  });
}
