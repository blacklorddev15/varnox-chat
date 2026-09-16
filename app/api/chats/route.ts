import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { chatSummaries, getUser, isAccountDeleted, liveUserIds } from '@/lib/db';
import { buildChatRow, emptySummary } from '@/lib/present';
import { createGroupConv, ensureDirectConv } from '@/lib/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const summaries = await chatSummaries(me.id);
    const chats = await Promise.all(summaries.map((s) => buildChatRow(me.id, s)));
    return ok({ chats });
  });
}

type CreateBody = {
  type?: 'direct' | 'group';
  userId?: string;
  name?: string;
  members?: string[];
};

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<CreateBody>(req);

    if (body.type === 'direct') {
      const otherId = clean(body.userId, 60);
      if (!otherId || otherId === me.id) return bad('Pick someone to chat with');
      const other = await getUser(otherId);
      if (!other) return bad('That user no longer exists', 404);
      // A deleted account still resolves through getUser, because deletion flags the row rather
      // than removing it — so the check above cannot catch one, and a direct chat could be opened
      // with an account that can never answer. Said in its own words rather than folded into
      // "no longer exists", because the two are different situations and this is the message
      // somebody sees after being told to look a name up.
      if (await isAccountDeleted(otherId)) return bad('This account is deleted', 410);
      const conv = await ensureDirectConv(me, otherId);
      const rows = await chatSummaries(me.id);
      const summary = rows.find((r) => r.conv.id === conv.id) ?? emptySummary(conv);
      return ok({ chat: await buildChatRow(me.id, summary) }, 201);
    }

    if (body.type === 'group') {
      const name = clean(body.name, 60) || 'New group';
      const wanted = Array.isArray(body.members) ? body.members.slice(0, 250).map(String) : [];
      // A group may be created with nobody else in it, then filled later.
      const resolved = await Promise.all(wanted.map((id) => getUser(id)));
      const candidates = resolved
        .filter((u): u is NonNullable<typeof u> => Boolean(u) && u!.id !== me.id)
        .map((u) => u.id);
      // Deleted accounts are dropped, not refused. The group is still worth creating, and one
      // stale id among twenty is no reason to lose the other nineteen. The panel cannot offer a
      // deleted account anyway — the directory no longer lists them — so this guards a request
      // built by hand, where the alternative is a group that quietly contains somebody who can
      // never read it.
      const live = await liveUserIds(candidates);
      const members = candidates.filter((id) => live.has(id));
      const conv = await createGroupConv(me, name, members);
      return ok({ chat: await buildChatRow(me.id, emptySummary(conv)) }, 201);
    }

    return bad('Unsupported conversation type');
  });
}
