import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser, publicUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { ensureSchema } from '@/lib/migrate';
import { telegramConfig, telegramSetupMessage } from '@/lib/telegram';
import { BotsScreen } from '@/components/bots-screen';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

/**
 * Bots is behind the same gate as the rest of the app, and the gate is here rather than in the
 * component: this function decides before any data is read, so an outsider who knows the URL
 * gets a redirect to the sign-in screen and nothing else. The screen's own API calls are
 * separately protected by requireUser(), so a page that somehow rendered would still fetch
 * nothing — the belt and braces are deliberate, because the page and the routes fail in
 * different ways.
 *
 * `metadata` is set per page rather than inherited so the tab does not say "Varnox" and nothing
 * else, and `robots` keeps a URL that only means anything when signed in out of search results.
 */
export const metadata: Metadata = {
  title: 'Bots',
  description:
    'Create and manage the Telegram bots this Varnox account owns, and the Varnox API token each one is issued.',
  robots: { index: false, follow: false },
};

export default async function BotsPage() {
  /**
   * Reconciled here for the same reason /chat and /admin do it: this page is the first request a
   * cold instance may serve, and nothing else would have brought the bot tables into existence
   * for it. Without this, a deploy that lands ahead of its migration answers 42703 on the first
   * visit rather than after a sign-in. It is a no-op once the process has run it.
   */
  await ensureSchema();

  const me = await currentUser();
  if (!me) redirect('/login');

  // Suspension is checked here as well as in requireUser(), because this page renders from the
  // session without going through it. Deletion needs no branch — currentUser() already returns
  // null for a deleted account, so the redirect above covers it.
  const suspension = await getSuspension(me.id);
  if (suspension) return <SuspendedScreen suspension={suspension} />;

  /**
   * The Telegram configuration is resolved on the server, where the environment variable lives,
   * and passed down as an answer rather than as a value. The browser is told *whether* there is a
   * bot API server — never its address, which the requirement keeps out of client code and which
   * would leak the operator's internal topology for no benefit.
   */
  const config = telegramConfig();

  return (
    <BotsScreen
      me={publicUser(me)}
      telegram={{
        configured: config.ok,
        setupMessage: config.ok ? null : telegramSetupMessage(config.reason),
      }}
    />
  );
}
