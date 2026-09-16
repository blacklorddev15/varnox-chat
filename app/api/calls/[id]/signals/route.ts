import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { callFor, listCallSignals } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Everything the other side has said after `?after=<seq>`.
 *
 * A cursor is the only safe way to read this: two signals can be written in the same
 * millisecond, and a timestamp would then either repeat one or skip one — and a skipped ICE
 * candidate is a call that never connects, with nothing on screen to say why.
 */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const after = Number(new URL(req.url).searchParams.get('after') ?? '0');

    // listCallSignals already refuses to return anyone else's signals, so this is not a leak —
    // but without it a stranger gets `200 { signals: [] }`, which reads exactly like a call
    // whose other side has not spoken yet. Saying so plainly is worth one indexed lookup.
    // 403 explicitly: bad() defaults to 400, and a body that says "Forbidden" beside a 400 is
    // the sort of small mismatch that costs somebody an afternoon.
    if (!(await callFor(id, me.id))) return bad('Forbidden: that call is not yours', 403);

    return ok({ signals: await listCallSignals(id, me.id, Number.isFinite(after) ? after : 0) });
  });
}
