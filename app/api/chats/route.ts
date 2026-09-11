import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { chatSummaries, getUser } from '@/lib/db';
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
      const members = resolved
        .filter((u): u is NonNullable<typeof u> => Boolean(u) && u!.id !== me.id)
        .map((u) => u.id);
      const conv = await createGroupConv(me, name, members);
      return ok({ chat: await buildChatRow(me.id, emptySummary(conv)) }, 201);
    }

    return bad('Unsupported conversation type');
  });
}
