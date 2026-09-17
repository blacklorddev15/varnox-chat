import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { hashPassword } from '@/lib/auth';
import { clearEmailCode, getUserByEmail, saveUser } from '@/lib/db';
import { verifyEmailCode } from '@/lib/email-code';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { email?: string; phone?: string; code?: string; password?: string };

/**
 * POST /api/auth/reset/confirm — a code and a new password.
 *
 * The pair is checked again here rather than assumed from the previous step. Each route stands on
 * its own: a request that arrives has to carry both claims itself, because nothing in a request
 * can be taken as having come from an earlier call.
 *
 * The proof is the consumed code row, exactly as registration uses it — the code was mailed to the
 * address the account holds, so reading that mailbox is the thing being demonstrated.
 *
 * The password is stored with hashPassword(), the same function the register route uses. A second
 * credential path would be a second place for the hashing to drift.
 *
 * KNOWN GAP, deliberately not hidden: this does not sign the account out of its existing devices.
 * Somebody who resets because they believe the account is compromised would want those sessions
 * gone too, and they are not. Clearing them means finding the device rows and deleting them, which
 * belongs with the sign-out-everywhere work rather than being half-done here.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const typed = clean(body.email, 254);
    const phone = normalisePhone(clean(body.phone, 20) ?? '');
    const code = clean(body.code, 12).replace(/\D/g, '');
    const password = typeof body.password === 'string' ? body.password : '';

    if (!typed) return bad('Enter your email address');
    if (!phone) return bad('Enter your number, including the country code');
    if (code.length !== 6) return bad('Enter the 6-digit code from the email');
    if (password.length < 6) return bad('Use at least 6 characters for your password');

    const user = await getUserByEmail(typed);
    if (!user || !user.phone || !user.email || user.phone !== phone) {
      return bad('Those details do not match an account', 403);
    }

    const result = await verifyEmailCode(user.email, code);
    if (!result.ok) return bad(result.error, result.status);

    await saveUser({ ...user, pwHash: hashPassword(password) });
    // Single use: the row that proved the address goes, so one code cannot set two passwords.
    await clearEmailCode(user.email);

    return ok({ reset: true });
  });
}
