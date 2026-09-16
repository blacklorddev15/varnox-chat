import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import {
  getConv,
  getConvReads,
  getMessageViews,
  getMessages,
  getReactions,
  getSettings,
  getTyping,
} from '@/lib/db';
import { newId } from '@/lib/ids';
import { deliverMessage } from '@/lib/service';
import type { Message, MessageType } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function hideBeforeFor(disappearSec: number | undefined): number | undefined {
  if (!disappearSec) return undefined;
  return Date.now() - disappearSec * 1000;
}

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
    const limit = Number(url.searchParams.get('limit') ?? 45);

    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const [result, reads, reactions, typing] = await Promise.all([
      getMessages(id, {
        limit: Number.isFinite(limit) ? limit : 45,
        cursor,
        since: since && since > 0 ? since : undefined,
        hideBefore: hideBeforeFor(conv.disappearSec),
      }),
      getConvReads(id),
      getReactions(id),
      getTyping(id),
    ]);

    // Who has opened which view-once message. Returned alongside the messages rather than
    // inside them, the same shape as reads and reactions: the sender needs to see "Opened",
    // and the recipient needs to know a message is already spent.
    const views = await getMessageViews(result.messages.map((m) => m.id));

    return ok({
      messages: result.messages,
      cursor: result.cursor ?? null,
      hasMore: result.hasMore,
      reads,
      reactions,
      views,
      typing: typing.filter((uid) => uid !== me.id),
      disappearSec: conv.disappearSec ?? 0,
      serverAt: Date.now(),
    });
  });
}

type SendBody = {
  text?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaW?: number;
  mediaH?: number;
  audioSec?: number;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  once?: boolean;
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
    const type: MessageType = ['image', 'audio', 'file'].includes(String(body.type))
      ? (body.type as MessageType)
      : 'text';
    const text = clean(body.text, 4000);
    const mediaUrl = clean(body.mediaUrl, 600);

    if (type === 'text' && !text) return bad('Message is empty');
    if (type !== 'text' && !mediaUrl) return bad('Upload failed');

    // Blocking: a direct chat is closed for both sides.
    if (conv.type === 'direct') {
      const peerId = conv.members.find((m) => m !== me.id);
      if (peerId) {
        const [mine, theirs] = await Promise.all([getSettings(me.id), getSettings(peerId)]);
        if (mine.blocked.includes(peerId) || theirs.blocked.includes(me.id)) {
          return bad("You can't send messages to this contact", 403);
        }
      }
    }

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
    if (type === 'audio') {
      msg.mediaUrl = mediaUrl;
      msg.audioSec = Math.max(1, Math.round(Number(body.audioSec) || 1));
      msg.mime = clean(body.mime, 80) || 'audio/webm';
    }
    if (type === 'file') {
      msg.mediaUrl = mediaUrl;
      msg.fileName = clean(body.fileName, 160) || 'Document';
      msg.fileSize = Math.max(0, Math.round(Number(body.fileSize) || 0));
      msg.mime = clean(body.mime, 120) || 'application/octet-stream';
    }
    // View-once applies to a photo or a voice note; a text message has nothing to hide.
    if (body.once && (type === 'image' || type === 'audio')) msg.once = true;

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
