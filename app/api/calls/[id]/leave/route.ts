import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { leaveCall } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Put the phone down without taking the call away from everybody else.
 *
 * This exists because a group call needs it and a one-to-one call never did. Hanging up on a
 * one-to-one call *is* the end of it, which is what the end route does; with three or more
 * people, one of them leaving must not end it for the rest.
 *
 * The call is ended only when the last person leaves — and because leaving empties a one-to-one
 * call too, this is also correct there, so the two routes converge on the same rule rather than
 * disagreeing about what "nobody left" means.
 *
 * Idempotent in effect, like end: a second request from a screen that is already tearing down
 * gets the call back rather than an error.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    return ok({ call: await leaveCall(id, me.id) });
  });
}
