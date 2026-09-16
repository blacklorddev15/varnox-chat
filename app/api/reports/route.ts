import { requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { createReport, getConv, getMessage, getUser, type ReportKind } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The reasons on offer, fixed rather than free text.
 *
 * A queue of prose cannot be counted, sorted or skimmed, and "other" plus a note covers whatever
 * the list forgot. The words are the ones a person would use, not internal categories, because
 * this is a menu somebody picks from while annoyed.
 */
const REASONS = ['spam', 'scam', 'harassment', 'impersonation', 'inappropriate', 'other'];
const KINDS: ReportKind[] = ['user', 'group', 'message'];

type Body = { kind?: string; targetId?: string; reason?: string; note?: string };

/**
 * Report a person, a group or one message.
 *
 * The name shown in the queue is resolved from the database and never taken from the request.
 * That is not tidiness: the queue is text an owner reads and then acts on, so anything the
 * reporter can put in it is a way to place a name in front of the owner that looks like a fact.
 * A reporter could otherwise file a report that appears to accuse somebody else entirely, and
 * the wrong account is exactly what gets suspended.
 *
 * Membership is checked for groups and messages, so a report cannot be filed into somebody
 * else's conversation.
 *
 * It is not, however, blind to whether an id exists: a group or message that is not found answers
 * 404 while one that is found but not joined answers 403, so a signed-in account can confirm an
 * id it already holds. That is a narrow oracle and it is left as it is — ids are a prefix, a
 * base36 timestamp and seven random characters, so there is nothing to walk, and collapsing the
 * two answers would take away the only distinction that tells a reporter whether they mistyped
 * something or are simply not a member. Worth writing down rather than claiming otherwise.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);

    const kind = String(body.kind ?? '') as ReportKind;
    if (!KINDS.includes(kind)) return bad('Nothing to report');

    const targetId = clean(body.targetId, 80);
    if (!targetId) return bad('Nothing to report');

    const reason = clean(body.reason, 40);
    if (!REASONS.includes(reason)) return bad('Pick a reason');

    let targetName: string;

    if (kind === 'user') {
      if (targetId === me.id) return bad('You cannot report yourself');
      const user = await getUser(targetId);
      if (!user) return bad('That account no longer exists', 404);
      targetName = user.displayName || user.username;
    } else if (kind === 'group') {
      const conv = await getConv(targetId);
      if (!conv || conv.type !== 'group') return bad('That group no longer exists', 404);
      if (!conv.members.includes(me.id)) return bad('You are not in that group', 403);
      targetName = conv.name || 'Unnamed group';
    } else {
      const msg = await getMessage(targetId);
      if (!msg) return bad('That message no longer exists', 404);
      const conv = await getConv(msg.convId);
      if (!conv || !conv.members.includes(me.id)) {
        return bad('You cannot report that message', 403);
      }
      // A snippet, so the queue says which message without copying a whole conversation into a
      // table that is read on a list screen.
      targetName = `${msg.senderName}: ${msg.text.slice(0, 80)}`;
    }

    const note = clean(body.note, 500) || null;

    const result = await createReport({
      reporterId: me.id,
      kind,
      targetId,
      targetName,
      reason,
      note,
    });

    if (!result.created) {
      // Two different situations that share an answer, kept apart because they mean different
      // things to the person pressing the button: one is "already have it", the other is "stop".
      if (result.tooMany) {
        return bad('You have too many reports open. Wait for these to be reviewed.', 429);
      }
      return ok({ alreadyReported: true });
    }

    return ok({ reported: true, id: result.id }, 201);
  });
}
