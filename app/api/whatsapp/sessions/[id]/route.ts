import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { forgetWhatsAppSession } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Forget one linked number.
 *
 * `id` is the bot's session id, read from the path as-is and only ever compared — the phone
 * number is never a route of its own, because a number in a path ends up in logs and history.
 * The delete is scoped to a session whose phone this user paired, so an id belonging to
 * somebody else is a plain not-found. This removes the list entry only; it does not sign the
 * device out of WhatsApp.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const forgotten = await forgetWhatsAppSession(me.id, id);
    if (!forgotten) return bad('That number is not linked to this account', 404);
    return ok({ ok: true });
  });
}
