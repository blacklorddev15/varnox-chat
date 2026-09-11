import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getStarred } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ starred: await getStarred(me.id) });
  });
}
