import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUser, isDeviceActive } from '@/lib/db';
import { publicUser, signClientToken, verifyClientToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Body = { refreshToken?: string };

/**
 * POST /api/v1/auth/refresh — a new access token, from a refresh token.
 *
 * Only a refresh token is accepted here, and only an access token is accepted on the other routes.
 * That separation is what makes the twelve-hour access life mean anything: without it a client
 * holding the thirty-day token would simply present that instead, and the short life would be
 * decoration.
 *
 * The device is re-checked, so revoking it ends the install immediately rather than at the next
 * expiry. The failure is one sentence either way, and the client's move is the same in all of
 * them: sign in again.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const claims = verifyClientToken(clean(body.refreshToken, 400), 'refresh');
    if (!claims) return bad('Sign in again', 401);
    if (!(await isDeviceActive(claims.did))) return bad('Sign in again', 401);

    const user = await getUser(claims.uid);
    if (!user) return bad('Sign in again', 401);

    return ok({
      accessToken: signClientToken(user.id, claims.did, 'access'),
      // NOTE, and it is a real limitation: the previous refresh token is not invalidated, so it
      // keeps working until it expires. Rotation without revocation is not rotation. Closing it
      // means storing the issued token (or a counter) against the device and refusing anything
      // older — a deliberate change to the device row, not a line to slip in here.
      refreshToken: signClientToken(user.id, claims.did, 'refresh'),
      expiresIn: 12 * 3600,
      user: publicUser(user),
    });
  });
}
