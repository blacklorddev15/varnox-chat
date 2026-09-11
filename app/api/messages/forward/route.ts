import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getMessages } from '@/lib/db';
import { forwardMessage } from '@/lib/service';

export const dynamic = 'force-dynamic';

type Body = { convId?: string; ids?: string[]; targets?: string[] };

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const convId = clean(body.convId, 60);
    const ids = (body.ids ?? []).slice(0, 50).map(String);
    const targets = (body.targets ?? []).slice(0, 20).map(String).filter((t) => t !== convId);

    if (!convId || !ids.length) return bad('Nothing to forward');
    if (!targets.length) return bad('Pick at least one chat to forward to');

    const source = await getConv(convId);
    if (!source) return bad('Chat not found', 404);
    if (!source.members.includes(me.id)) return bad('You are not in this chat', 403);

    const { messages } = await getMessages(convId, { limit: 200 });
    const picked = messages.filter((m) => ids.includes(m.id) && m.type !== 'system');
    if (!picked.length) return bad('Those messages are no longer available');

    let sent = 0;
    for (const targetId of targets) {
      const target = await getConv(targetId);
      if (!target || !target.members.includes(me.id)) continue;
      for (const msg of picked) {
        await forwardMessage(me, target, msg);
        sent++;
      }
    }
    if (!sent) return bad('None of the selected chats accepted the forward', 403);
    return ok({ forwarded: sent, targets: targets.length });
  });
}
