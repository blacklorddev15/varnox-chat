import { bad, clean, clientIp, handle, ok, readJsonBody } from '@/lib/api';
import { startEmailCode } from '@/lib/email-code';
import { maskPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { email?: string; phone?: string; dial?: string };

/**
 * POST /api/auth/email/send — mail a code to an address, before any account exists.
 *
 * Unauthenticated, and that is the whole reason it is not simply /api/auth/email/start. That one
 * sends to the signed-in account's address, which is what the profile screen needs when an address
 * changes. This one runs during registration, where there is no session yet, so it cannot read an
 * address from one and has to take it from the body.
 *
 * Taking an address from the body is the thing to be careful about: it means this endpoint can be
 * pointed at a stranger's mailbox. So it is the one that most needs the limits, and it has them —
 * a resend cooldown, three sends per address per fifteen minutes, and ten per connection per hour,
 * all enforced inside startEmailCode() rather than being the job of each caller.
 *
 * It deliberately does NOT report whether the address is already registered. Answering "that is
 * taken" here would turn this into a way to test any address against the account list, and the
 * register route already refuses a taken one with a message that is far more useful because it
 * arrives at the moment the visitor cares.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const email = clean(body.email, 254);
    if (!email) return bad('Enter your email address');

    // The number is only for the message, so a wrong one is cosmetic rather than dangerous —
    // and it is masked before it goes anywhere, so the full number never reaches a mailbox.
    const phone = clean(body.phone, 20);
    const dial = clean(body.dial, 4);
    const result = await startEmailCode(email, clientIp(req), maskPhone(phone, dial));
    if (!result.ok) return bad(result.error, result.status);

    return ok({
      sent: true,
      to: result.to,
      expiresInSec: result.expiresInSec,
      resendInSec: result.resendInSec,
    });
  });
}
