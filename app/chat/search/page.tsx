import type { Metadata } from 'next';

import { GatedMessenger } from '@/components/gated';

/**
 * A page under /chat, so it renders the shell: the sidebar, and this column. Messenger reads the
 * path and puts the matching pane here, which is what makes the URL real rather than decorative —
 * a hard load of this address paints the screen, and the back gesture has somewhere to go.
 *
 * The gate moved to lib/use-gate.tsx, and the reason is in app/chat/page.tsx. What stayed is
 * `metadata`: a page marked 'use client' cannot export it, so this one stays a server component
 * and renders a client component inside.
 */
export const metadata: Metadata = {
  title: 'Search messages',
  description: 'Search across the conversations in this Varnox account for a word or phrase.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <GatedMessenger />;
}
