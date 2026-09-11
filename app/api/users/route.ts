import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { searchUsers } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const q = new URL(req.url).searchParams.get('q') ?? '';
    if (q.trim().length < 1) return ok({ users: [] });
    const users = await searchUsers(q, me.id);
    return ok({ users });
  });
}
