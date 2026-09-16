import { redirect } from 'next/navigation';
import { currentUser, publicUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { Messenger } from '@/components/messenger';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const me = await currentUser();
  if (!me) redirect('/login');

  /**
   * Suspension is checked here as well as in requireUser(), and both are needed.
   *
   * requireUser() closes the API — no route will answer a suspended account — but this page is
   * rendered from the session alone, without going through it. So without this branch a
   * suspended account would be handed the entire messenger and would discover the suspension one
   * failed action at a time, which looks like the app being broken rather than a decision.
   *
   * Deletion needs no branch here: currentUser() returns null for a deleted account, so the
   * redirect above already covers it.
   */
  const suspension = await getSuspension(me.id);
  if (suspension) return <SuspendedScreen suspension={suspension} />;

  return <Messenger me={publicUser(me)} />;
}
