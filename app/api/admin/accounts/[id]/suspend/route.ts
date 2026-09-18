import { requireAdmin } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getSuspension, getUser, recordAdminAction, suspendAccount } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  reason?: string;
  /**
   * How long the suspension lasts, in milliseconds. Null or absent means it has no end and stands
   * until somebody lifts it — which is what every suspension was before this existed, so a client
   * that sends only a reason gets exactly the behaviour it always got.
   */
  durationMs?: number | null;
};

/** A minute is the shortest sentence worth imposing; a year the longest this will accept. */
const MIN_SUSPEND_MS = 60_000;
const MAX_SUSPEND_MS = 365 * 24 * 60 * 60_000;

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

    /*
     * The end date is computed here, from a length, and never taken as a date from the client.
     * A date from the client would be a date the client's clock decided, and a device that is
     * wrong by a day — or set forward on purpose — would be choosing how long somebody is
     * suspended. A length has no such reach: whatever the clock says, the suspension starts when
     * this request is handled and lasts as long as it was asked to.
     */
    let until: number | null = null;
    if (body.durationMs != null) {
      const ms = Number(body.durationMs);
      if (!Number.isFinite(ms) || ms < MIN_SUSPEND_MS || ms > MAX_SUSPEND_MS) {
        return bad('A suspension must last between a minute and a year', 400);
      }
      until = Date.now() + Math.round(ms);
    }

    const done = await suspendAccount(id, reason, until);
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
      // The length is part of the decision, so it is part of the record. An audit line carrying
      // only the note would leave out the more consequential half of what was just done.
      detail:
        until == null
          ? reason
          : [reason, `until ${new Date(until).toISOString()}`].filter(Boolean).join(' · '),
    });

    return ok({ suspension: await getSuspension(id) });
  });
}
