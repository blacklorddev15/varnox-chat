import { publicUser, setSessionCookie } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUser, redeemLinkCode } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Body = { code?: string; label?: string };

/**
 * The one message every failure gets. See the comment on POST for why there is only one.
 */
const REFUSED = 'That code is not valid or has expired';

/**
 * Best-effort client address, recorded on the device row. Mirrors the helper in the OTP
 * route: it is a label for the user's own device list, never an authorisation decision.
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 60);
  }
  return req.headers.get('x-real-ip')?.trim().slice(0, 60) ?? null;
}

/**
 * POST /api/link/redeem — sign this device in with a code from another one.
 *
 * Deliberately not signed in: the device has no session yet, which is the point.
 *
 * An unknown code, an expired code and an already-used code all produce the same refusal.
 * Distinguishing them would let a stranger learn whether a code ever existed, and would make
 * the endpoint an oracle for telling live codes from dead ones. The single atomic update in
 * redeemLinkCode() is what makes "already used" true even when two attempts arrive together.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);

    const result = await redeemLinkCode(clean(body.code, 40), {
      label: clean(body.label, 60) || null,
      userAgent: clean(req.headers.get('user-agent'), 200) || null,
      ip: clientIp(req),
    });
    if (!result) return bad(REFUSED);

    const user = await getUser(result.userId);
    if (!user) return bad(REFUSED);

    // The new session names its device, so it can be signed out again from the first device.
    await setSessionCookie(user.id, result.deviceId);
    return ok({ user: publicUser(user) });
  });
}
