import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { chatSummaries, getConv, getInvite } from '@/lib/db';
import { buildChatRow } from '@/lib/present';
import { recordGroupEvent, refreshConv } from '@/lib/service';

export const dynamic = 'force-dynamic';

/** Join a group using an invite code. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<{ code?: string }>(req);
    const code = clean(body.code, 24).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!code) return bad('Missing invite code');

    const invite = await getInvite(code);
    if (!invite) return bad('That invite link is not valid', 404);

    const conv = await getConv(invite.convId);
    if (!conv) return bad('That group no longer exists', 404);

    if (!conv.members.includes(me.id)) {
      const next = { ...conv, members: [...conv.members, me.id] };
      await refreshConv(next);
      // Existing members are told who joined. Delivered against `next` so the person joining
      // sees it in the thread too, rather than arriving to a group with no sign they joined.
      await recordGroupEvent(me, next, `${me.displayName} joined using an invite link`);
    }

    const rows = await chatSummaries(me.id);
    const summary = rows.find((r) => r.conv.id === conv.id) ?? {
      conv,
      last: null,
      unread: 0,
      readAt: 0,
      updatedAt: Date.now(),
      pinned: false,
      muted: false,
      archived: false,
    };
    return ok({ chat: await buildChatRow(me.id, summary), joined: true });
  });
}
