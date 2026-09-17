import { Messenger } from '@/components/messenger';
import { pageGate } from '@/lib/page-gate';

export const dynamic = 'force-dynamic';

/**
 * The gate moved to lib/page-gate when the five panes became routes and needed it too. The
 * reasoning that used to be inlined here went with it — reconcile before reading, because a
 * cold instance whose first request is a page would otherwise read a column that does not
 * exist yet; check suspension here as well as in requireUser(), because a page renders from
 * the session alone and a suspended account would otherwise be handed the whole app; and no
 * branch for deletion, because currentUser() already returns null for a deleted account.
 *
 * One copy of the lockout check for all six pages, which is the point of the extraction.
 */
export default async function ChatPage() {
  const gate = await pageGate();
  if (!gate.ok) return gate.screen;
  return <Messenger me={gate.me} isAdmin={gate.isAdmin} />;
}
