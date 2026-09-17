'use client';

import { useState } from 'react';

/** Remembered for this browser session only. See the note below on why not any longer. */
const DISMISSED_KEY = 'varnox:welcome-dismissed';

/**
 * The first thing a new account sees: a circle with a picture, one friendly line, and a gold Start.
 *
 * It is shown while the account has no conversations, rather than exactly once ever. That is a
 * deliberate reading of "after the user enters": somebody looking at an empty chat list is the
 * person this is for, and showing it to them again is an invitation rather than an interruption.
 * The moment they have a conversation it is gone for good.
 *
 * Dismissal lasts the browser session, so a reload does not put it straight back while somebody is
 * still deciding. It is not remembered across sessions on purpose: that would mean writing a flag
 * on the account, which means the settings table, the settings route's whitelist and the insert
 * statement all moving together — worth doing if this should be strictly once-ever, but an empty
 * list is the honest condition for wanting to say hello, and it needs none of that.
 */
export function WelcomeOverlay({ name }: { name?: string }) {
  const [gone, setGone] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Private mode, or storage disabled. Showing it is the better failure: the alternative is a
      // new account that never gets welcomed.
      return false;
    }
  });

  if (gone) return null;

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        {/*
          Empty alt on purpose: the picture is decoration here, and announcing it would put a
          filename or a guess at its contents in front of the actual message.
        */}
        <img className="welcome-face" src="/welcome.jpg" alt="" width={88} height={88} />
        <p className="welcome-kicker">Welcome to</p>
        <h2 id="welcome-title">Varnox</h2>
        <p className="welcome-line">
          This is a place to make friends{name ? `, ${name}` : ''}. Talk about nothing in particular,
          find people who get you, and keep the ones worth keeping.
        </p>
        <button
          className="btn"
          onClick={() => {
            try {
              window.sessionStorage.setItem(DISMISSED_KEY, '1');
            } catch {
              /* nothing to remember with — the button still works */
            }
            setGone(true);
          }}
        >
          Start
        </button>
      </div>
    </div>
  );
}
