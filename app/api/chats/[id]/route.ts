import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { chatSummaries, getConv, getConvReads, getUser, liveUserIds } from '@/lib/db';
import { buildChatRow, emptySummary } from '@/lib/present';
import {
  describeMembers,
  hideConvFor,
  namesFor,
  recordGroupEvent,
  refreshConv,
} from '@/lib/service';

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

    // Only genuine changes are collected. Re-adding somebody who is already in the group is not
    // an event, and an entry claiming something happened when nothing did is worse than no entry.
    const addedIds: string[] = [];

    if (Array.isArray(body.addMembers) && body.addMembers.length) {
      const wanted = body.addMembers.slice(0, 100).map(String).filter((uid) => uid !== me.id);
      // A deleted account still resolves through getUser, so the existence check below cannot
      // keep one out — it would be added to the member list and then hidden from it again by
      // presentMember, leaving the group with a member nobody can see. Asked once for the whole
      // batch rather than once per id, because this loop can carry a hundred of them.
      const live = await liveUserIds(wanted);
      for (const uid of wanted) {
        const user = await getUser(uid);
        if (!user) continue;
        if (!live.has(uid)) continue;
        if (!members.has(uid)) addedIds.push(uid);
        members.add(uid);
      }
    }

    const removedIds: string[] = [];

    if (Array.isArray(body.removeMembers) && body.removeMembers.length) {
      if (!isGroup) return bad('You cannot remove anyone from a direct chat');
      if (!isAdmin) return bad('Only group admins can remove members', 403);
      for (const raw of body.removeMembers.slice(0, 100)) {
        const uid = String(raw);
        if (uid === me.id) continue;
        if (members.has(uid)) removedIds.push(uid);
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

    // Written after the member list is saved, so each event reaches exactly the people it
    // should: whoever just joined sees it, whoever just left does not.
    if (addedIds.length) {
      await recordGroupEvent(
        me,
        next,
        `${me.displayName} added ${describeMembers(await namesFor(addedIds))}`
      );
    }

    if (removedIds.length) {
      await recordGroupEvent(
        me,
        next,
        `${me.displayName} removed ${describeMembers(await namesFor(removedIds))}`
      );
    }

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

    // The people still in the group are told. This deliberately targets `next`, not the
    // conversation the leaver was in — they have just hidden it, and telling somebody about an
    // event they can no longer see is pointless. When the last member leaves there is nobody
    // left to tell, so nothing is written.
    if (next.members.length) {
      await recordGroupEvent(me, next, `${me.displayName} left`);
    }

    return ok({ left: true });
  });
}
