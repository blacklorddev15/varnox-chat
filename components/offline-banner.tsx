'use client';

import { useSyncExternalStore } from 'react';
import { isOffline, subscribeNetwork } from '@/lib/offline';

/**
 * Says, once, why nothing is arriving and why sending will not work.
 *
 * Without it the app offline looks like a chat that has simply stopped: the last messages are
 * on screen, which is exactly what it looks like when nobody has written anything. The banner
 * is the difference between "nobody has messaged me" and "I am not connected".
 *
 * It says what still works as well as what does not. "You're offline" on its own reads as a
 * failure and invites somebody to close the app; saying the messages on screen are the last
 * ones it received, and that only sending is blocked, is the same fact phrased so it is worth
 * reading. That wording covers both causes deliberately — a device with no connection and a
 * backend that is not answering produce the same screen and, from in here, are the same
 * situation.
 *
 * Mounted in the root layout, so it is not tied to a screen. It starts hidden and only appears
 * once a request has actually failed — not on `navigator.onLine` being false at load, which is
 * wrong on a captive portal and would flash on a phone that is about to connect.
 *
 * Subscribed with useSyncExternalStore rather than an effect setting state, because that is
 * exactly what this is: a component reading a value that lives outside React. The third
 * argument is the server snapshot, false, so the server render and the first client render agree
 * — the alternative is a hydration mismatch on a banner that is hidden most of the time.
 */
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribeNetwork, isOffline, () => false);
  if (!offline) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      Can&rsquo;t reach Varnox — you&rsquo;re seeing the last messages it sent. Reading works;
      sending needs a connection.
    </div>
  );
}
