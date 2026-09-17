import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { markEmailVerified, unconsumeEmailCode } from '@/lib/db';
import { verifyEmailCode } from '@/lib/email-code';

export const dynamic = 'force-dynamic';

type Body = { code?: string };

/**
 * POST /api/auth/email/verify — check a confirmation code for the signed-in account.
 *
 * The address comes from the session and the code from the body. That split is the security
 * property worth stating plainly: a caller can only ever confirm the address their own account
 * already holds. Taking the address from the request instead would let any signed-in user
 * confirm an address belonging to somebody else, which is the one thing this flow exists to
 * prove.
 *
 * Because a code cannot sign anybody in — it is read here against the session, not exchanged for
 * one — a leaked code is only useful to the person already holding the account. That is why the
 * dev-mode inbox can be authenticated rather than hidden.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const code = clean(body.code, 12).replace(/\D/g, '');

    if (!me.email) {
      return bad('There is no email address on this account to confirm.', 409);
    }
    if (code.length !== 6) return bad('Enter the 6-digit code from the email');

    // Already confirmed: answer as success rather than as an error, so a second tab, a double
    // tap or a stale page is not told that something went wrong.
    if (me.emailVerifiedAt !== null) {
      return ok({ verified: true, to: me.email, already: true });
    }

    const result = await verifyEmailCode(me.email, code);
    if (!result.ok) return bad(result.error, result.status);

    const marked = await markEmailVerified(me.id, me.email);
    if (!marked) {
      /**
       * The code was correct and has already been consumed by this point, so a failure to write
       * has to give it back — otherwise the user is left holding a code that silently did
       * nothing and has to ask for another. lib/otp.ts's route does the same thing for the same
       * reason. This is narrow: it means the account was deleted, or the address moved, between
       * the session being read and the update running.
       */
      await unconsumeEmailCode(me.email, result.codeHash);
      return bad('That address is no longer on this account, so it was not confirmed.', 409);
    }

    return ok({ verified: true, to: me.email });
  });
}
