import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { createStatus, listStatusFeed, takeRateSlot } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Long enough for a thought, short enough to stay a status rather than an essay. */
const MAX_TEXT = 700;
const KINDS = ['text', 'image'] as const;

/**
 * Posting is capped per account, in its own bucket so a busy updates tab cannot exhaust the
 * OTP or sign-in limits (and the other way round).
 */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 20;

/** The feed for the signed-in user: their own group plus everyone they may see. */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ feed: await listStatusFeed(me.id) });
  });
}

type Body = {
  kind?: string;
  text?: string;
  mediaUrl?: string;
  bg?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);

    const kind = KINDS.find((k) => k === body.kind);
    if (!kind) return bad('An update must be text or a photo');

    // Validate the payload before spending a rate slot: a malformed request should not cost
    // a caller one of their twenty posts.
    const text = clean(body.text, MAX_TEXT);
    const mediaUrl = clean(body.mediaUrl, 600);
    if (kind === 'text' && !text) return bad('Write something for your update');
    if (kind === 'image' && !mediaUrl) return bad('A photo update needs an image');

    const slot = await takeRateSlot(`status:${me.id}`, RATE_WINDOW_MS, RATE_LIMIT);
    if (!slot.allowed) {
      const minutes = Math.ceil(slot.retryAfterMs / 60_000);
      return bad(`You have posted too many updates. Try again in ${minutes} min.`, 429);
    }

    const status = await createStatus(me.id, {
      kind,
      text: text || null,
      mediaUrl: kind === 'image' ? mediaUrl : null,
      bg: kind === 'text' ? clean(body.bg, 40) || null : null,
    });
    return ok({ status }, 201);
  });
}
