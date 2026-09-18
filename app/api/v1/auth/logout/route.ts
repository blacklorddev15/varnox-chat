import { handle, ok } from '@/lib/api';
import { revokeDevice } from '@/lib/db';
import { bearerFrom, verifyClientToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/logout — end this install's session.
 *
 * Takes the access token it is signing out with. A client that wants to sign out should not have to
 * still be holding its refresh token to do it.
 *
 * Revokes the device rather than deleting a token, because the device is the thing that exists —
 * which is also why this is idempotent, and why the answer is the same whether or not the token was
 * still valid. There is nothing for a caller to learn from a failure here, so there is no failure.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const claims = verifyClientToken(bearerFrom(req), 'access');
    if (claims) await revokeDevice(claims.uid, claims.did);
    return ok({ signedOut: true });
  });
}
