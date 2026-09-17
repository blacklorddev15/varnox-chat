import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser, publicUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { ensureSchema } from '@/lib/migrate';
import { SupportBot } from '@/components/support-bot';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

/**
 * The Varnox Support Bot, inside the app.
 *
 * Gated exactly like /bots, and the order of the three checks matters: reconcile the schema
 * before touching it, resolve the session before reading anything about the account, and check
 * suspension before rendering a screen that can create credentials.
 *
 * That gate is also what makes this design safe. A bot reached over Telegram would have to prove
 * who is talking to it before issuing anything; here the answer is already settled, because only
 * a signed-in account can load this page. The credential-minting path is unreachable to anyone
 * who does not already own the account it mints for.
 *
 * `robots` keeps a URL that only means anything when signed in out of search results.
 */
export const metadata: Metadata = {
  title: 'Varnox Support Bot',
  description: 'Create and manage the bots on this Varnox account by talking to it.',
  robots: { index: false, follow: false },
};

export default async function SupportBotPage() {
  await ensureSchema();

  const me = await currentUser();
  if (!me) redirect('/login');

  const suspension = await getSuspension(me.id);
  if (suspension) return <SuspendedScreen suspension={suspension} />;

  return <SupportBot me={publicUser(me)} />;
}
