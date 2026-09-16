import { bad, clean, handle, ok } from '@/lib/api';
import { devCodeForNewNumber, takeRateSlot } from '@/lib/db';
import { devMode } from '@/lib/sms';

export const dynamic = 'force-dynamic';

/**
 * The code that was just made for a number, for when there is no SMS to send it with.
 *
 * Unauthenticated by necessity — this is read during registration, before there is an account
 * to be signed in as. So the guard is the query, not a session: `devCodeForNewNumber` returns
 * nothing unless the number has no account yet.
 *
 * That restriction is the entire reason this is safe to expose. The code step is also how you
 * sign IN, so a version that answered for existing numbers would let anybody who knows a phone
 * number read its code and enter that account — with nothing but the number. Refusing for
 * registered numbers means a code read here can only create an account, never enter one.
 *
 * Rate-limited per IP, in its own bucket, because it is unauthenticated and returns something
 * worth having. Failing this endpoint is a dead end for one person, not for the server, so it
 * answers "nothing to show" rather than an error wherever it is unsure.
 */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 12;

export async function GET(req: Request) {
  return handle(async () => {
    // With dev mode off nothing is recorded, so there is never anything to show. Answering
    // rather than erroring keeps the screen simple, and it means the feature switches itself
    // off on any deployment that is really sending SMS.
    if (!devMode()) return ok({ available: false });

    const phone = clean(new URL(req.url).searchParams.get('phone'), 24);
    if (!phone) return bad('Which number?');

    const slot = await takeRateSlot(`otpinbox:${clientKey(req)}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) return bad('Too many requests. Try again shortly.', 429);

    const found = await devCodeForNewNumber(phone);
    if (!found) return ok({ available: false });

    /* The code is pulled out of the message rather than stored beside it, because the message is
     * what was recorded and is the only thing that exists. Six digits, matching the code length
     * lib/otp.ts generates. A message in a shape this does not recognise still shows in full —
     * only the one-tap fill is lost, which is the right way round. */
    const matched = found.body.match(/\b(\d{6})\b/);

    return ok({ available: true, body: found.body, code: matched ? matched[1] : null, at: found.at });
  });
}

/** Best effort client identity for the rate bucket. */
function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
