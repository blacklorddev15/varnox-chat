import type { Metadata } from 'next';
import { Messenger } from '@/components/messenger';
import { pageGate } from '@/lib/page-gate';

export const dynamic = 'force-dynamic';

/**
 * `metadata` is set per page rather than inherited, so the tab names the screen instead of saying
 * "Varnox" and nothing else, and so a URL that only means anything when signed in stays out of
 * search results — the same reasoning as /bots.
 */
export const metadata: Metadata = {
  title: 'My profile',
  description: 'Edit the display name, handle and picture that other Varnox accounts see.',
  robots: { index: false, follow: false },
};

/**
 * A page under /chat, so it renders the shell: the sidebar, and this column. Messenger reads the
 * path and puts the matching pane here, which is what makes the URL real rather than decorative —
 * a hard load of this address paints the screen, and the back gesture has somewhere to go.
 */
export default async function Page() {
  const gate = await pageGate();
  if (!gate.ok) return gate.screen;
  return <Messenger me={gate.me} isAdmin={gate.isAdmin} />;
}
