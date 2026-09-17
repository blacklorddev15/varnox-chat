import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { verifyEmailCode } from '@/lib/email-code';

export const dynamic = 'force-dynamic';

type Body = { email?: string; code?: string };

/**
 * POST /api/auth/email/confirm — check a code for an address that is not yet an account.
 *
 * Unauthenticated, like its send counterpart and for the same reason: registration has no session
 * yet. Unlike /api/auth/email/verify, which answers for the signed-in account, this one proves an
 * address on behalf of nobody in particular — which is exactly what signing up is.
 *
 * The proof is left in the database rather than handed back as a token. verifyEmailCode() marks
 * the row consumed, and /api/auth/register accepts an address only while such a row is recent. A
 * signed ticket would be a second secret to get right and a second thing to expire; a row the
 * server wrote itself cannot be forged at all, which is the stronger of the two.
 *
 * Nothing is returned but success. There is no session to hand back — the account does not exist
 * until the wizard submits it — and the address is not echoed, because the caller just typed it.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const email = clean(body.email, 254);
    const code = clean(body.code, 12).replace(/\D/g, '');

    if (!email) return bad('Enter your email address');
    if (code.length !== 6) return bad('Enter the 6-digit code from the email');

    const result = await verifyEmailCode(email, code);
    if (!result.ok) return bad(result.error, result.status);

    return ok({ verified: true });
  });
}
