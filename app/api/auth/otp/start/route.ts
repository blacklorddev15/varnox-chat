import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { normalisePhone } from '@/lib/phone';
import { startOtp } from '@/lib/otp';

export const dynamic = 'force-dynamic';

type Body = { phone?: string };

/**
 * Best-effort client address for the per-IP send throttle.
 *
 * Vercel sets x-forwarded-for, and the first entry is the client. This is only a
 * throttle key, never an authorisation decision, so a spoofed value costs an attacker
 * their own bucket rather than someone else's.
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
 * POST /api/auth/otp/start — send a login code to a phone number.
 *
 * The response never says whether the number already has an account. Revealing that
 * would turn this endpoint into a way to test which numbers are registered, so the
 * caller finds out only after the code comes back.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const phone = normalisePhone(clean(body.phone, 24));
    if (!phone) return bad('Enter a valid phone number, including the country code');

    const result = await startOtp(phone, clientIp(req));
    if (!result.ok) return bad(result.error, result.status);

    return ok({
      sent: true,
      to: result.to,
      expiresInSec: result.expiresInSec,
      resendInSec: result.resendInSec,
    });
  });
}
