import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { getWhatsAppPairing } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Poll one pairing request.
 *
 * Scoped to its owner: an id that is not this user's reads as missing, so a stranger cannot
 * learn somebody else's pairing code by asking for it. The bot writes `status` and the code as
 * it works, so this answer changes between one poll and the next — the code only appears once
 * the bot has written it, which is what the screen waits for.
 */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const pairingId = Number(id);
    if (!Number.isInteger(pairingId) || pairingId < 1) {
      return bad('Unknown pairing request', 404);
    }

    const pairing = await getWhatsAppPairing(pairingId, me.id);
    if (!pairing) return bad('Unknown pairing request', 404);
    return ok({ pairing });
  });
}
