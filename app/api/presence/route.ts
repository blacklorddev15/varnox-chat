import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getPresenceMany, heartbeat, saveUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Presence heartbeat. Called while the app is open; also refreshes lastSeen on
 * the user record so the value survives if the presence index is pruned.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    let ids: string[] = [];
    try {
      const body = (await req.json()) as { ids?: string[] };
      if (Array.isArray(body?.ids)) ids = body.ids.slice(0, 60).map(String);
    } catch {
      /* no body is fine */
    }

    await heartbeat(me.id);
    if (Date.now() - me.lastSeen > 120_000) {
      await saveUser({ ...me, lastSeen: Date.now() });
    }

    const presence = ids.length ? await getPresenceMany(ids.filter((id) => id !== me.id)) : {};
    return ok({ at: Date.now(), presence });
  });
}
