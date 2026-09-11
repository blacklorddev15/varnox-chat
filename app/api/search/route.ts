import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getConv, searchMessages } from '@/lib/db';
import { peerIdOf, presentMember } from '@/lib/present';

export const dynamic = 'force-dynamic';

/** Search message text across the signed-in user's conversations. */
export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const q = new URL(req.url).searchParams.get('q') ?? '';
    const hits = await searchMessages(me.id, q);

    const results = await Promise.all(
      hits.map(async (hit) => {
        let title = hit.convName;
        if (hit.convType === 'direct') {
          const conv = await getConv(hit.convId);
          const peerId = conv ? peerIdOf(conv, me.id) : null;
          const peer = peerId ? await presentMember(peerId, me.id) : null;
          title = peer?.displayName ?? 'Direct chat';
        }
        return {
          convId: hit.convId,
          convType: hit.convType,
          title,
          messages: hit.messages.slice(0, 5),
        };
      })
    );

    return ok({ query: q, results });
  });
}
