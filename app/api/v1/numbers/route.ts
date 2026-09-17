import { handle, ok } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { listWhatsAppSessions } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The numbers the token's owner has paired, and can therefore be messaged from.
 *
 * The same list the pairing screen shows, scoped to the owner the token belongs to — so an
 * integration can discover where it is allowed to send instead of being configured with a session
 * id by hand.
 *
 * It returns the phone numbers. That is worth stating rather than leaving implicit: a token holder
 * can read the account's paired numbers in full. Masking them would be theatre, because a session
 * id is literally `web_` followed by the same number — hiding one and not the other would obscure
 * the value without hiding it. So the honest arrangement is to return them and be clear that a
 * token is worth this much.
 *
 * `listWhatsAppSessions` already excludes anything that is not `connected`, which is the rule the
 * chat screen follows: a thread is only meaningful for a number that finished pairing.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    return ok({ numbers: await listWhatsAppSessions(auth.ownerId) });
  });
}
