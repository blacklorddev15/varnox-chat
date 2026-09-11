import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getMessages, setStar } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function locate(convId: string, msgId: string, userId: string) {
  const conv = await getConv(convId);
  if (!conv) throw new Error('Chat not found');
  if (!conv.members.includes(userId)) throw new Error('Forbidden');
  const { messages } = await getMessages(convId, { limit: 200 });
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) throw new Error('Message not found');
  return { conv, msg };
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ convId?: string }>(req);
    const convId = clean(body.convId, 60);
    if (!convId) return bad('Missing conversation');

    const { conv, msg } = await locate(convId, id, me.id);
    const title = conv.type === 'group' ? conv.name : 'Direct chat';
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
      id
    );
    return ok({ starred: true, id });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    let convId = new URL(req.url).searchParams.get('convId') ?? '';
    if (!convId) {
      try {
        const body = await readJsonBody<{ convId?: string }>(req);
        convId = clean(body?.convId, 60);
      } catch {
        /* ignore */
      }
    }
    await setStar(null, me.id, id);
    return ok({ starred: false, id, convId });
  });
}
