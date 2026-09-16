import { requireAdmin } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { closeReport, getReport, recordAdminAction } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a report as dealt with.
 *
 * Closing means "a decision was made", not "the accused was punished" — the punishment is a
 * separate action with its own route and its own audit row. Keeping them apart is what makes the
 * log readable: a closed report with no suspension beside it says the report was looked at and
 * nothing was warranted, which is a real and common outcome worth being able to see.
 *
 * `closeReport` only matches an open row, so closing twice reports that nothing happened instead
 * of overwriting whoever handled it first with whoever looked at it second.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId < 1) return bad('No such report', 404);

    // Read before closing, only to name the target in the audit row. A report is about somebody,
    // and "closed report 12" would be worth nothing to whoever reads this later.
    const report = await getReport(reportId);
    if (!report) return bad('No such report', 404);
    if (report.status !== 'open') return bad('That report has already been closed', 409);

    const done = await closeReport(reportId, admin.displayName || admin.username);
    if (!done) return bad('That report has already been closed', 409);

    await recordAdminAction({
      actor: admin,
      action: 'close-report',
      targetId: report.targetId,
      targetName: report.targetName,
      detail: `${report.kind} report: ${report.reason}`,
    });

    return ok({ closed: true });
  });
}
