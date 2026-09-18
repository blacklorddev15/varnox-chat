import { bad, handle, ok } from '@/lib/api';
import { clientUser } from '@/lib/auth';
import { publicUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/me — who this client token is.
 *
 * The mirror of /api/v1/me for the other kind of token. It exists so a client can find out its
 * credential is stale with one cheap request, rather than by having a send fail.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const me = await clientUser(req);
    if (!me) return bad('Sign in again', 401);
    return ok({ user: publicUser(me) });
  });
}
