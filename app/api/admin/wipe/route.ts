import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { STEPS } from '@/lib/migrate';
import { q } from '@/lib/pg';

export const dynamic = 'force-dynamic';

/** Typed out in full. A wipe is not something to reach by pressing the wrong button. */
const CONFIRMATION = 'wipe everything';

/**
 * POST /api/admin/wipe — drop every table, then rebuild the empty schema.
 *
 * requireAdmin() is the entire guard, and it is two independent checks rather than one: the
 * account must be on the allowlist, and the admin password must have been entered within the last
 * half hour. Neither is enough alone — an allowlisted account on a phone left unlocked in a pocket
 * must not be able to empty the database.
 *
 * The body must carry the exact words. A confirmation step rather than a button, because this is
 * the only action in the product that cannot be undone by doing the opposite thing afterwards, and
 * the panel around it is a screen of buttons that all can.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin();

    const body = await readJsonBody<{ confirm?: string }>(req);
    if (clean(body.confirm, 40).toLowerCase().trim() !== CONFIRMATION) {
      return bad(`Type "${CONFIRMATION}" to confirm — this cannot be undone.`, 400);
    }

    /*
      Logged to the deployment's console as well as being an API call, and that is not belt-and-
      braces. The audit table lives in the database this request is about to empty, so an audit row
      would be the one record guaranteed not to survive the action it describes. The deployment log
      is the only place this can be recorded that the wipe cannot reach.
    */
    console.warn(
      `[varnox] DATABASE WIPE requested by ${me.username} (${me.id}) at ${new Date().toISOString()}`
    );

    await q('drop schema public cascade');
    await q('create schema public');
    await q('grant all on schema public to public');

    /*
      Rebuilt here, in this request, rather than left to the next one.

      ensureSchema() runs once per process, so a warm deployment has no reason to run it again and
      every request after a wipe would fail with "relation does not exist" until the process
      happened to recycle. A wipe that leaves the app broken until it redeploys is a trap rather
      than a feature. STEPS is the same list ensureSchema() uses, in the same order, and every
      statement is guarded by "if not exists" so running it against a fresh schema is safe.
    */
    for (const step of STEPS) {
      await q(step.sql);
    }

    console.warn('[varnox] DATABASE WIPE complete — the schema is rebuilt and empty');

    return ok({
      wiped: true,
      steps: STEPS.length,
      note:
        'Every account, message, setting and stored file is gone, including your own — you are ' +
        'signed out, and the admin allowlist now names an account that no longer exists. The empty ' +
        'schema is in place, so the app works; register again to get back in.',
    });
  });
}
