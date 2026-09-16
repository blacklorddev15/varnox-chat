import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { PAIRING_BUSY, pairingPhone, startWhatsAppPairing, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Starting a pairing is capped per account, in its own bucket so a run of pairing requests
 * cannot exhaust the OTP, sign-in, status or channel limits (and the other way round).
 */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 10;

type Body = { phone?: string };

/**
 * Queue a "Link WhatsApp" request for the external bot to pick up.
 *
 * The number is normalised here as well as in the datastore so a malformed request is refused
 * before it costs a rate slot. The bot polls the table, writes the code, and
 * GET /api/whatsapp/pair/[id] reports what it did.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);

    const phone = pairingPhone(clean(body.phone, 40));
    if (!phone) {
      return bad('Enter the number in full international form, including the country code.');
    }

    const slot = await takeRateSlot(`whatsapp:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const minutes = Math.ceil(slot.retryAfterMs / 60_000);
      return bad(`Too many pairing attempts. Try again in ${minutes} min.`, 429);
    }

    try {
      const pairing = await startWhatsAppPairing(me.id, phone);
      return ok({ pairing }, 201);
    } catch (err) {
      // Already having one in flight is the caller's state, not a server fault: answer with a
      // conflict rather than letting it become a 500.
      if (err instanceof Error && err.message === PAIRING_BUSY) return bad(err.message, 409);
      throw err;
    }
  });
}
