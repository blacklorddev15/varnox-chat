import { GatedMessenger } from '@/components/gated';

/**
 * The app shell.
 *
 * This used to gate here, deciding from the session before any data was read. The decision moved
 * to lib/use-gate.tsx when the app gained an offline mode: a page that reads the session with
 * `cookies()` cannot be rendered ahead of time, and being rendered ahead of time is what lets
 * the app open with no network at all.
 *
 * Nothing is lost by it. The API routes are still gated by requireUser(), which is where the
 * enforcement always actually was — the gate here was a convenience that kept a signed-out
 * visitor from seeing a shell they could not use, and the client gate still does that.
 */
export default function ChatPage() {
  return <GatedMessenger />;
}
