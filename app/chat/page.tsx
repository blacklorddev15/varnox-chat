import { redirect } from 'next/navigation';
import { currentUser, isAdmin, publicUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { ensureSchema } from '@/lib/migrate';
import { Messenger } from '@/components/messenger';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  /**
   * Reconcile before reading. Only `handle()` does this for API routes, and this page is not one
   * — so on a cold instance whose first request is this page rather than an API call, the
   * suspension columns would not exist yet and the render would fail with 42703. Reading a column
   * this page did not previously touch is what made that possible, so the page has to bring the
   * schema up itself. It is a no-op once the process has done it.
   */
  await ensureSchema();

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

  // Decided here, from the same allowlist the admin routes use, so the row in Settings and the
  // routes behind it cannot disagree. This only decides whether to draw a link — every route
  // checks again for itself, and the page checks before it reads anything.
  return <Messenger me={publicUser(me)} isAdmin={isAdmin(me)} />;
}
