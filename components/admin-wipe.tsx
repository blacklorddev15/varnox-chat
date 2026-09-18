'use client';

import { useState } from 'react';
import { post } from '@/lib/client';

/**
 * The only irreversible control in the admin panel.
 *
 * It asks for the words to be typed, using the browser's own prompt, for the same reason the rest
 * of this panel does: a typed value cannot be skipped or pre-filled, and a styled modal with a
 * comfortable "Yes" button is easier to mis-click than a text box is to mistype. Everything else
 * on the page can be undone by doing the opposite thing afterwards. This cannot.
 *
 * It keeps its own state rather than taking props, so it is self-contained: the panel does not
 * have to know whether a wipe is running, and a failed wipe cannot leave the rest of the page
 * showing stale counts as though nothing happened.
 */
export function AdminWipe() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <div className="admin-section-title">Danger</div>
      </div>

      <p className="hint" style={{ marginBottom: 12 }}>
        Empties the database — every account, message, setting and stored file, including your own.
        The empty schema is rebuilt immediately, so the app keeps working with nothing in it. There
        is no undo, and every session is signed out.
      </p>

      <button
        className="btn ghost"
        disabled={busy}
        onClick={async () => {
          const typed = window.prompt(
            'This deletes everything, including your own account.\n\nType: wipe everything'
          );
          if (typed === null) return;

          setBusy(true);
          setNote('');
          try {
            const res = await post<{ note: string }>('/api/admin/wipe', { confirm: typed });
            setNote(res.note);
          } catch (err) {
            setNote(err instanceof Error ? err.message : 'The wipe failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Wiping…' : 'Wipe the database'}
      </button>

      {note ? (
        <p className="admin-note" style={{ marginTop: 12 }}>
          {note}
        </p>
      ) : null}
    </section>
  );
}
