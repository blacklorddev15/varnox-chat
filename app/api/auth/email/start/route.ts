import { requireUser } from '@/lib/auth';
import { bad, clientIp, handle, ok } from '@/lib/api';
import { startEmailCode } from '@/lib/email-code';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/email/start — send a confirmation code to the signed-in account's address.
 *
 * The address is taken from the session and never from the body, and that is the whole of the
 * authorisation here. There is no way to ask for a code to be delivered anywhere else, so this
 * cannot be turned into a way to post mail at a stranger, and it is why the reply can name the
 * address freely — the only person who can read it already owns it.
 *
 * Refused when the account has no address, and refused when it is already confirmed: a resend
 * there would spend the sending quota to prove something already proved.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();

    if (!me.email) {
      return bad('There is no email address on this account to confirm.', 409);
    }
    if (me.emailVerifiedAt !== null) {
      return ok({ sent: false, alreadyVerified: true, to: me.email });
    }

    const result = await startEmailCode(me.email, clientIp(req));
    if (!result.ok) return bad(result.error, result.status);

    return ok({
      sent: true,
      to: result.to,
      expiresInSec: result.expiresInSec,
      resendInSec: result.resendInSec,
    });
  });
}
