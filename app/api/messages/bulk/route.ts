import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getMessages, saveMessageOp, setStar } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Body = {
  convId?: string;
  ids?: string[];
  action?: 'delete' | 'star' | 'unstar';
};

/** Multi-select actions over several messages in one conversation. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const convId = clean(body.convId, 60);
    const ids = (body.ids ?? []).slice(0, 200).map(String);
    const action = body.action;

    if (!convId || !ids.length) return bad('Nothing selected');
    const conv = await getConv(convId);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);
    if (!action) return bad('Missing action');

    const { messages } = await getMessages(convId, { limit: 200 });
    const selected = messages.filter((m) => ids.includes(m.id));
    const title = conv.type === 'group' ? conv.name : 'Direct chat';

    if (action === 'delete') {
      const mine = selected.filter((m) => m.senderId === me.id);
      for (const msg of mine) {
        await saveMessageOp({ convId, msgId: msg.id, op: 'delete', at: Date.now() });
      }
      return ok({ deleted: mine.length, skipped: selected.length - mine.length });
    }

    for (const msg of selected) {
      if (action === 'star') {
        await setStar(
          {
            userId: me.id,
            msgId: msg.id,
            convId,
            convName: title,
            at: Date.now(),
            snapshot: {
              text: msg.type === 'text' ? msg.text : '',
              type: msg.type,
              senderName: msg.senderName,
              at: msg.at,
              mediaUrl: msg.mediaUrl,
              fileName: msg.fileName,
            },
          },
          me.id,
          msg.id
        );
      } else {
        await setStar(null, me.id, msg.id);
      }
    }
    return ok({ [action === 'star' ? 'starred' : 'unstarred']: selected.length });
  });
}
