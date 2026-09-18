'use client';

import { Gate, Redirect } from '@/lib/use-gate';
import { Messenger } from './messenger';

/**
 * The gated screens, wrapped once each.
 *
 * The pages that use these stay server components: they hold no data any more, but they still
 * carry each screen's `metadata`, and a page marked `'use client'` cannot export that. Losing it
 * would quietly drop the `robots: noindex` that keeps signed-in addresses out of search results,
 * which is not a thing worth losing to save a file.
 *
 * The alternative — a `layout.tsx` per route to hold the metadata — was rejected for the opposite
 * reason: eleven files to say one thing each, when the page is already there and already the
 * right place for it.
 *
 * `Gate` hands the callback a real user, so nothing below has to consider the possibility of
 * there not being one. See lib/use-gate.tsx.
 */

/** The app shell: sidebar, chat column, and whatever pane the path selects. */
export function GatedMessenger() {
  return <Gate>{(gate) => <Messenger me={gate.me} isAdmin={gate.isAdmin} />}</Gate>;
}

/**
 * The root address, which has no screen of its own — it only decides where to send somebody.
 *
 * Kept as a component rather than a redirect in the page because the answer depends on the
 * session, and on the client that means waiting for it. There is nothing to show in the
 * meantime, which is what the gate's own loading state is for.
 */
export function GatedHome() {
  return <Gate>{() => <Redirect to="/chat" />}</Gate>;
}
