import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { listCallHistory, startCall, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KINDS = ['audio', 'video'] as const;

/**
 * Starting a call is capped per account, in its own bucket so a run of calls cannot exhaust
 * the OTP, sign-in, status or channel limits (and the other way round). The window is short
 * because a call is cheap to refuse: what this stops is a loop hammering the table, not
 * somebody having a busy afternoon.
 */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;

/** The calls the signed-in user made or took, newest first. */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ calls: await listCallHistory(me.id) });
  });
}

type Body = {
  calleeId?: string;
  kind?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);

    const calleeId = clean(body.calleeId, 80);
    if (!calleeId) return bad('Choose someone to call');

    const kind = KINDS.find((k) => k === body.kind);
    if (!kind) return bad('A call must be audio or video');

    // Validate before spending a rate slot: a malformed request should not cost a caller one
    // of their twenty calls.
    const slot = await takeRateSlot(`call:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const seconds = Math.ceil(slot.retryAfterMs / 1000);
      return bad(`You have started too many calls. Try again in ${seconds}s.`, 429);
    }

    return ok({ call: await startCall(me.id, calleeId, kind) }, 201);
  });
}
