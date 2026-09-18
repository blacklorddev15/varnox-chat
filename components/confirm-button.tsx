'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * A destructive action that has to be asked for twice.
 *
 * `window.confirm()` is the obvious tool and the wrong one here, for a reason that is invisible
 * until somebody tries it: the Android shell does not implement `onJsConfirm`, so in the app the
 * dialog never appears and the answer is always "no". A browser would show it and the app would
 * quietly do nothing — the worst kind of difference between the two, because it works everywhere
 * it is tested and fails only in the place people actually use.
 *
 * It replaces itself rather than opening a layer, so it can sit inside a menu without one closing
 * the other. Clicking the trigger puts the question where the trigger was, which keeps the
 * decision in the same place on screen as the thing that asked for it.
 *
 * Gives up on its own after a few seconds. A confirmation left sitting in an open menu stops
 * reading as a question and starts reading as a button, and the next tap is a mis-tap away from
 * being the answer.
 */
export function ConfirmButton({
  children,
  question,
  confirmLabel,
  onConfirm,
  className,
  style,
}: {
  children: ReactNode;
  question: string;
  /** Said in words rather than "Yes", so the button still says what it does. */
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const id = window.setTimeout(() => setAsking(false), 8000);
    return () => window.clearTimeout(id);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className={className} style={style} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }

  return (
    <div className="confirm-ask" role="group" aria-label={question}>
      <span className="confirm-q">{question}</span>
      <button
        type="button"
        className="btn danger"
        onClick={() => {
          // Closed first: the action may navigate or unmount this, and leaving the question
          // showing over a screen that has already changed is worse than a flash of both.
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  );
}
