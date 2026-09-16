import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { MAX_SIGNAL_PAYLOAD, addCallSignal } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const KINDS = ['offer', 'answer', 'candidate'] as const;

type Body = {
  kind?: string;
  payload?: string;
  /**
   * Which peer this signal is for.
   *
   * Omit it on a one-to-one call, where there is only ever one other person and the signal is
   * for them by definition — left out, it stays readable by both sides exactly as it always was.
   *
   * A call with three or more people must set it. An offer and an ICE candidate each belong to
   * a single peer, so an unaddressed one is read by everybody, and each of them tries to answer
   * something that was addressed to somebody else. That is the specific failure this field
   * exists to prevent.
   */
  to?: string;
};

/**
 * Post one signal.
 *
 * There is no WebSocket, so this is how an offer, an answer or an ICE candidate crosses: it is
 * written to vx_call_signals and the other browser reads it on its next poll, by cursor.
 * `payload` is the stringified SDP or candidate exactly as the browser produced it.
 *
 * Failures here are deliberately quiet on the client: a signal that arrives just as the call
 * ends is not an error worth interrupting anybody over.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = await readJsonBody<Body>(req);

    const kind = KINDS.find((k) => k === body.kind);
    if (!kind) return bad('That is not a call signal');

    // Checked here rather than left to the throw inside addCallSignal: a throw would surface as
    // a 500, which says "this server is broken" for what is really a malformed request.
    const payload = String(body.payload ?? '');
    if (!payload) return bad('An empty call signal cannot be sent');
    if (payload.length > MAX_SIGNAL_PAYLOAD) return bad('That call signal is too large');

    // Absent means broadcast, which is what a one-to-one client sends. Handing that straight
    // through is what keeps the existing one-to-one screens working untouched.
    const to = clean(body.to, 80) || null;
    if (to && to === me.id) return bad('A call signal cannot be addressed to its own sender');

    await addCallSignal(id, me.id, kind, payload, to);
    return ok({ sent: true });
  });
}
