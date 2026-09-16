import { requireAdmin } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { blockPhone, listBlockedPhones, recordAdminAction } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { phone?: string; reason?: string };

/** Numbers that may not sign up or sign in. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    return ok({ blocked: await listBlockedPhones(limit) });
  });
}

/**
 * Block a number.
 *
 * Validated with normalisePhone first, and refused if it will not parse. A blocklist entry that
 * cannot be matched by the signup path is worse than none: it looks like protection while the
 * number walks straight past it, and the failure is silent forever after.
 *
 * Unblocking is a separate route rather than a DELETE on a path, because a phone number carries a
 * leading plus and belongs in a request body rather than a URL.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJsonBody<Body>(req);

    const raw = clean(body.phone, 30);
    const phone = normalisePhone(raw);
    if (!phone) return bad('Enter a valid phone number including country code');

    const reason = clean(body.reason, 200) || null;
    await blockPhone(phone, reason, admin.displayName || admin.username);

    await recordAdminAction({
      actor: admin,
      action: 'block-phone',
      targetId: phone,
      // The number is the name it has. There is no account to resolve it to: half the point of a
      // blocklist is the numbers that never got an account.
      targetName: phone,
      detail: reason,
    });

    return ok({ blocked: phone }, 201);
  });
}
