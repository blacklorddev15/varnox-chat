import { requireAdmin } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { recordAdminAction, unblockPhone } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { phone?: string };

/**
 * Lift a block on a number.
 *
 * Reported honestly when nothing was blocked: an owner who unblocks a number that was never on
 * the list has done nothing, and a success response would leave them believing the list says
 * something it does not.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJsonBody<Body>(req);

    const phone = normalisePhone(clean(body.phone, 30));
    if (!phone) return bad('Enter a valid phone number including country code');

    const done = await unblockPhone(phone);
    if (!done) return bad('That number is not blocked', 409);

    await recordAdminAction({
      actor: admin,
      action: 'unblock-phone',
      targetId: phone,
      targetName: phone,
      detail: null,
    });

    return ok({ unblocked: phone });
  });
}
