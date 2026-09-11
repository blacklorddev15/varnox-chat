import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getConv, getConvReads, getMessages } from '@/lib/db';
import { newId } from '@/lib/blob';
import { deliverMessage } from '@/lib/service';
import type { Message } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await getConv(id);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get('since');
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Number(url.searchParams.get('limit') ?? 40);

    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const result = await getMessages(id, {
      limit: Number.isFinite(limit) ? limit : 40,
      cursor,
      since: since && since > 0 ? since : undefined,
    });

    const reads = await getConvReads(id);
    return ok({
      messages: result.messages,
      cursor: result.cursor ?? null,
      hasMore: result.hasMore,
      reads,
      serverAt: Date.now(),
    });
  });
}

type SendBody = {
  text?: string;
  type?: 'text' | 'image';
  mediaUrl?: string;
  mediaW?: number;
  mediaH?: number;
  replyTo?: { id: string; text: string; senderName: string } | null;
};

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await getConv(id);
    if (!conv) return bad('Chat not found', 404);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    const body = await readJsonBody<SendBody>(req);
    const type = body.type === 'image' ? 'image' : 'text';
    const text = clean(body.text, 4000);
    const mediaUrl = clean(body.mediaUrl, 600);

    if (type === 'text' && !text) return bad('Message is empty');
    if (type === 'image' && !mediaUrl) return bad('Image upload failed');

    const msg: Message = {
      id: newId('m'),
      convId: conv.id,
      senderId: me.id,
      senderName: me.displayName,
      at: Date.now(),
      type,
      text,
    };
    if (type === 'image') {
      msg.mediaUrl = mediaUrl;
      if (body.mediaW) msg.mediaW = Math.round(Number(body.mediaW)) || undefined;
      if (body.mediaH) msg.mediaH = Math.round(Number(body.mediaH)) || undefined;
    }
    if (body.replyTo?.id) {
      msg.replyTo = {
        id: clean(body.replyTo.id, 60),
        text: clean(body.replyTo.text, 200),
        senderName: clean(body.replyTo.senderName, 40),
      };
    }

    await deliverMessage(me, conv, msg);
    return ok({ message: msg, serverAt: Date.now() }, 201);
  });
}
