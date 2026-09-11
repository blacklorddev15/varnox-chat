import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getMessages, saveMessageOp } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function findOwnMessage(convId: string, msgId: string, userId: string) {
  const conv = await getConv(convId);
  if (!conv) throw new Error('Chat not found');
  if (!conv.members.includes(userId)) throw new Error('Forbidden');
  const { messages } = await getMessages(convId, { limit: 200 });
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) throw new Error('Message not found');
  if (msg.senderId !== userId) throw new Error('Forbidden');
  return msg;
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const body = await readJsonBody<{ convId?: string; text?: string }>(req);
    const convId = clean(body.convId, 60);
    const text = clean(body.text, 4000);
    if (!convId) return bad('Missing conversation');
    if (!text) return bad('Message cannot be empty');

    await findOwnMessage(convId, id, me.id);
    await saveMessageOp({ convId, msgId: id, op: 'edit', text, at: Date.now() });
    return ok({ edited: true, id, text });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    let convId = url.searchParams.get('convId') ?? '';
    if (!convId) {
      try {
        const body = await readJsonBody<{ convId?: string }>(req);
        convId = clean(body?.convId, 60);
      } catch {
        /* ignore */
      }
    }
    if (!convId) return bad('Missing conversation');

    await findOwnMessage(convId, id, me.id);
    await saveMessageOp({ convId, msgId: id, op: 'delete', at: Date.now() });
    return ok({ deleted: true, id });
  });
}
