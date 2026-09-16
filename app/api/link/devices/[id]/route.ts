import { currentDeviceId, requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { revokeDevice } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/link/devices/[id] — sign another device out of this account.
 *
 * The device making the request is refused. Revoking yourself would end the session you are
 * asking with, half way through the action, which reads as the app misbehaving; signing out
 * is the door for that. The update is scoped to the account, so a device id belonging to
 * somebody else is a plain not-found.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;

    const current = await currentDeviceId();
    if (current && id === current) {
      return bad('You cannot log out the device you are using. Use Sign out instead.');
    }

    const revoked = await revokeDevice(me.id, id);
    if (!revoked) return bad('That device is not signed in to this account', 404);
    return ok({ ok: true });
  });
}
