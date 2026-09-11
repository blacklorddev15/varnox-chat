import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getSettings, searchUsers } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const q = new URL(req.url).searchParams.get('q') ?? '';
    if (q.trim().length < 1) return ok({ users: [] });

    const [found, mine] = await Promise.all([searchUsers(q, me.id), getSettings(me.id)]);
    // Hide users this account has blocked, and anyone who has blocked this account.
    const others = await Promise.all(found.map((u) => getSettings(u.id)));
    const users = found.filter((u, i) => {
      if (mine.blocked.includes(u.id)) return false;
      if (others[i].blocked.includes(me.id)) return false;
      return true;
    });

    return ok({ users });
  });
}
