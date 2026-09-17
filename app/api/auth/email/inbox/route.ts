import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { devCodeForEmail } from '@/lib/db';
import { devMode } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/**
 * The code that was just made for the signed-in account's address, for when there is no mail to
 * send it with.
 *
 * Authenticated, unlike the SMS equivalent, and that difference is what makes this safe without
 * that endpoint's "only for numbers that have no account yet" restriction. This reads the
 * caller's own address out of the session, so it can only ever reveal a code that was already
 * going to them. The phone version has to be unauthenticated because it runs during signup
 * before an account exists, which is why its guard lives in the query instead.
 *
 * With dev mode off nothing is recorded, so there is never anything to show. Answering rather
 * than erroring keeps the screen simple, and it means the feature switches itself off on any
 * deployment that is really sending mail.
 */
export async function GET() {
  return handle(async () => {
    if (!devMode()) return ok({ available: false });

    const me = await requireUser();
    if (!me.email) return ok({ available: false, reason: 'no-email' });

    const found = await devCodeForEmail(me.email);
    if (!found) return ok({ available: false });

    /* The code is pulled out of the message rather than stored beside it, because the message is
     * what was recorded and is the only thing that exists. Six digits, matching the length
     * lib/email-code.ts generates. A message in a shape this does not recognise still shows in
     * full — only the one-tap fill is lost, which is the right way round. */
    const matched = found.body.match(/\b(\d{6})\b/);

    return ok({ available: true, body: found.body, code: matched ? matched[1] : null, at: found.at });
  });
}
