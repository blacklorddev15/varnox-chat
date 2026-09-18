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
  isAccountDeleted,
} from '@/lib/db';
import { newId } from '@/lib/ids';
import { peerIdOf } from '@/lib/present';
import { normalisePhone } from '@/lib/phone';
import { deliverMessage } from '@/lib/service';
import type { Message, MessagePayload, MessageType } from '@/lib/types';

/** The message types that carry no attachment. */
const NO_MEDIA: MessageType[] = ['text', 'location', 'contact'];

/** Longest serialised payload accepted; these objects are meant to be tiny. */
const MAX_PAYLOAD_CHARS = 2000;

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
  payload?: MessagePayload;
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

    // A one-to-one thread with an account that has since been deleted stays readable, because
    // the history belongs to both parties — but nothing new goes into it. Refusing only at
    // chat-creation time would leave the second, equally ordinary way of messaging somebody
    // open: opening the thread that already exists and typing. The composer is still enabled
    // there, so the refusal has to be here, and it has to name which of the two situations this
    // is — the chat exists, the person does not.
    const peerId = peerIdOf(conv, me.id);
    if (peerId && (await isAccountDeleted(peerId))) {
      return bad('This account is deleted', 410);
    }

    const body = await readJsonBody<SendBody>(req);
    const type: MessageType = ['image', 'audio', 'video', 'file', 'location', 'contact'].includes(
      String(body.type)
    )
      ? (body.type as MessageType)
      : 'text';
    const text = clean(body.text, 4000);
    const mediaUrl = clean(body.mediaUrl, 600);

    if (type === 'text' && !text) return bad('Message is empty');
    // A location or contact card has no media; every other non-text type must have some.
    if (!NO_MEDIA.includes(type) && !mediaUrl) return bad('Upload failed');

    // The structured payload that a location or contact message carries.
    let payload: MessagePayload | undefined;
    if (type === 'location' || type === 'contact') {
      if (body.payload == null) return bad('A location or contact needs a payload');
      if (JSON.stringify(body.payload).length > MAX_PAYLOAD_CHARS) {
        return bad('That message payload is too large');
      }
    }
    if (type === 'location') {
      const lat = Number(body.payload?.lat);
      const lng = Number(body.payload?.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return bad('Latitude must be a number between -90 and 90');
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return bad('Longitude must be a number between -180 and 180');
      }
      payload = { lat, lng };
      const label = clean(body.payload?.label, 120);
      if (label) payload.label = label;
    }
    if (type === 'contact') {
      const name = clean(body.payload?.name, 80);
      if (!name) return bad('A contact card needs a name');
      const phone = normalisePhone(body.payload?.phone);
      if (!phone) return bad('A contact card needs a valid phone number');
      payload = { name, phone };
    }

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
    if (type === 'video') {
      msg.mediaUrl = mediaUrl;
      msg.mime = clean(body.mime, 80) || 'video/mp4';
      // Dimensions are the poster frame's, used to lay the bubble out before the video loads.
      if (body.mediaW) msg.mediaW = Math.round(Number(body.mediaW)) || undefined;
      if (body.mediaH) msg.mediaH = Math.round(Number(body.mediaH)) || undefined;
    }
    if (type === 'file') {
      msg.mediaUrl = mediaUrl;
      msg.fileName = clean(body.fileName, 160) || 'Document';
      msg.fileSize = Math.max(0, Math.round(Number(body.fileSize) || 0));
      msg.mime = clean(body.mime, 120) || 'application/octet-stream';
    }
    if (payload) msg.payload = payload;
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
