import { requireAdmin } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listReports, openReportCount } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The report queue.
 *
 * Defaults to open reports only, because the useful screen is the one with work on it — a closed
 * report needs no decision. `?only=all` is there for history when a decision has to be explained
 * later, which is also what the audit log is for.
 *
 * `open` is returned alongside so a caller can show a backlog without counting the list.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const params = new URL(req.url).searchParams;
    const only = params.get('only') === 'all' ? 'all' : 'open';
    const limitRaw = Number(params.get('limit') ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    const [reports, open] = await Promise.all([listReports(only, limit), openReportCount()]);
    return ok({ reports, open });
  });
}
