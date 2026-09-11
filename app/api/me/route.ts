import { currentUser, publicUser, requireUser } from '@/lib/auth';
import { clean, handle, ok, readJsonBody } from '@/lib/api';
import { saveUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const me = await currentUser();
    return ok({ user: me ? publicUser(me) : null });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<{ displayName?: string; about?: string; avatar?: string | null }>(req);

    const next = { ...me, lastSeen: Date.now() };
    if (body.displayName !== undefined) {
      const name = clean(body.displayName, 40);
      if (name) next.displayName = name;
    }
    if (body.about !== undefined) next.about = clean(body.about, 140);
    if (body.avatar !== undefined) {
      next.avatar = body.avatar ? clean(body.avatar, 500) : null;
    }
    await saveUser(next);
    return ok({ user: publicUser(next) });
  });
}
