import { bad, clean, clientIp, handle, ok, readJsonBody } from '@/lib/api';
import { getUserByEmail } from '@/lib/db';
import { startEmailCode } from '@/lib/email-code';
import { maskPhone, normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { email?: string; phone?: string };

/**
 * POST /api/auth/reset/start — begin a password reset.
 *
 * The email and the number together have to name the same account, and a pair that does not is
 * refused. The number was never verified when it was given, so this is not a second proof — it is
 * a second claim, and matching it makes a reset something you have to know two things to reach
 * rather than one.
 *
 * The cost of that is worth writing down rather than discovering later: a number mistyped at
 * signup was never checked, cannot be corrected from outside, and cannot be recovered without
 * emailing. An account like that can never be reset. This was a deliberate choice by the
 * deployment's owner — email alone has no such failure mode, and asks less of whoever is trying.
 *
 * The refusal is the same sentence whether the address is unknown or the number is wrong. Saying
 * which one failed would turn this into a way to find out who has an account here.
 *
 * The code goes to the address the account holds, not to the string that was typed. When they
 * differ, the account wins — otherwise the input would be choosing where the mail goes.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const typed = clean(body.email, 254);
    const phone = normalisePhone(clean(body.phone, 20) ?? '');

    if (!typed) return bad('Enter your email address');
    if (!phone) return bad('Enter your number, including the country code');

    const user = await getUserByEmail(typed);
    if (!user || !user.phone || !user.email || user.phone !== phone) {
      return bad('Those details do not match an account', 403);
    }

    const result = await startEmailCode(user.email, clientIp(req), maskPhone(user.phone));
    if (!result.ok) return bad(result.error, result.status);

    return ok({ sent: true, to: result.to, resendInSec: result.resendInSec });
  });
}
