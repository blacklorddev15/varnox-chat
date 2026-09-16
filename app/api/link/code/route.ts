import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { createLinkCode, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Codes, per account, per hour. A few is generous — linking a device is something a person
 * does once in a while — and the cap is what stops this endpoint being used to sit and mint
 * codes until one is guessed.
 */
const CODES_PER_HOUR = { windowMs: 60 * 60_000, limit: 5 };

/**
 * POST /api/link/code — mint the code that links another device.
 *
 * Only a signed-in account can ask for one, because the code is the credential the other
 * device presents. Minting replaces any code that is still live, so there is never more than
 * one way in at a time.
 */
export async function POST() {
  return handle(async () => {
    const me = await requireUser();

    const slot = await takeRateSlot(
      `link:user:${me.id}`,
      CODES_PER_HOUR.windowMs,
      CODES_PER_HOUR.limit
    );
    if (!slot.allowed) {
      const minutes = Math.max(1, Math.ceil(slot.retryAfterMs / 60_000));
      return bad(
        `Too many link codes requested. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        429
      );
    }

    const { code, expiresInSec } = await createLinkCode(me.id);
    return ok({ code, expiresInSec });
  });
}
