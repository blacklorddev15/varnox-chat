import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { chatSummaries, getConv, getConvReads, getUser } from '@/lib/db';
import { buildChatRow, emptySummary } from '@/lib/present';
import { hideConvFor, refreshConv } from '@/lib/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function loadConv(id: string) {
  const conv = await getConv(id);
  if (!conv) throw new Error('Chat not found');
  return conv;
}

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await loadConv(id);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    const summaries = await chatSummaries(me.id);
    const summary =
      summaries.find((s) => s.conv.id === conv.id) ?? emptySummary(conv, conv.createdAt);
    const reads = await getConvReads(conv.id);
    return ok({ chat: await buildChatRow(me.id, summary), reads });
  });
}

type PatchBody = {
  name?: string;
  avatar?: string | null;
  addMembers?: string[];
  removeMembers?: string[];
  /** disappearing messages: 0 = off, otherwise seconds */
  disappearSec?: number;
};

const DISAPPEAR_CHOICES = [0, 86_400, 604_800, 7_776_000];

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await loadConv(id);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    const body = await readJsonBody<PatchBody>(req);
    const isGroup = conv.type === 'group';
    const isAdmin = !isGroup || conv.admins.includes(me.id);

    const members = new Set(conv.members);
    let name = conv.name;
    let avatar = conv.avatar;

    if (body.name !== undefined) {
      if (!isGroup) return bad('Only groups can be renamed');
      if (!isAdmin) return bad('Only group admins can rename the group', 403);
      const next = clean(body.name, 60);
      if (!next) return bad('Group name cannot be empty');
      name = next;
    }

    if (body.avatar !== undefined) {
      if (!isGroup) return bad('Only groups can have a group photo');
      if (!isAdmin) return bad('Only group admins can change the group photo', 403);
      avatar = body.avatar ? clean(body.avatar, 500) : null;
    }

    if (Array.isArray(body.addMembers) && body.addMembers.length) {
      for (const raw of body.addMembers.slice(0, 100)) {
        const uid = String(raw);
        if (uid === me.id) continue;
        const user = await getUser(uid);
        if (user) members.add(uid);
      }
    }

    if (Array.isArray(body.removeMembers) && body.removeMembers.length) {
      if (!isGroup) return bad('You cannot remove anyone from a direct chat');
      if (!isAdmin) return bad('Only group admins can remove members', 403);
      for (const raw of body.removeMembers.slice(0, 100)) {
        const uid = String(raw);
        if (uid === me.id) continue;
        members.delete(uid);
        const stillThere = await getConv(conv.id);
        if (stillThere) await hideConvFor({ ...stillThere, members: [uid] }, uid);
      }
    }

    let disappearSec = conv.disappearSec ?? 0;
    if (body.disappearSec !== undefined) {
      if (isGroup && !isAdmin) {
        return bad('Only group admins can change disappearing messages', 403);
      }
      const wanted = Math.round(Number(body.disappearSec));
      if (!DISAPPEAR_CHOICES.includes(wanted)) return bad('Unsupported timer value');
      disappearSec = wanted;
    }

    const next = {
      ...conv,
      name,
      avatar,
      disappearSec,
      members: [...members],
      admins: conv.admins.filter((a) => members.has(a)),
    };
    await refreshConv(next);
    return ok({ conv: next });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await ctx.params;
    const conv = await loadConv(id);
    if (!conv.members.includes(me.id)) return bad('You are not in this chat', 403);

    const remaining = conv.members.filter((m) => m !== me.id);
    const next = {
      ...conv,
      members: remaining,
      admins: conv.admins.filter((a) => a !== me.id),
    };
    if (conv.type === 'group' && remaining.length > 0) {
      await refreshConv(next, remaining);
    } else if (remaining.length > 0) {
      await refreshConv(next, remaining);
    }
    await hideConvFor(conv, me.id);
    return ok({ left: true });
  });
}
