'use client';

import { AdminWipe } from './admin-wipe';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import type { AdminAuditEntry, AdminAccount, BlockedPhone, Report } from '@/lib/db';

/**
 * The owner's controls.
 *
 * Rendered only for an account on the allowlist, and only once the admin password has been
 * entered — both are enforced on the server, so this component being in the bundle tells nobody
 * anything and its presence is not the gate.
 *
 * Confirmations use the browser's own prompt rather than a sheet of this app's own. That is a
 * deliberate trade: deleting an account here takes a typed handle, exactly as the self-service
 * route does, and `prompt` makes the typed value impossible to skip or pre-fill. A styled modal
 * would look better and be easier to mis-click.
 */
export function AdminPanel({
  me,
  accounts,
  reports,
  blocked,
  audit,
  openReports,
}: {
  me: { username: string; displayName: string };
  accounts: AdminAccount[];
  reports: Report[];
  blocked: BlockedPhone[];
  audit: AdminAuditEntry[];
  openReports: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [onlySuspended, setOnlySuspended] = useState(false);

  async function run(
    key: string,
    label: string,
    fn: () => Promise<unknown>
  ): Promise<void> {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(label);
      // The lists are rendered on the server, so the truth comes back from there rather than
      // being patched into local state — which is also what keeps the audit log honest.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const shown = onlySuspended ? accounts.filter((a) => a.suspendedAt) : accounts;

  return (
    <div className="admin-wrap">
      <div className="admin-head">
        <div>
          <div className="admin-title">Admin control</div>
          <div className="hint" style={{ margin: 0 }}>
            Signed in as {me.displayName || me.username}
          </div>
        </div>
        <button
          type="button"
          className="btn ghost"
          disabled={busy !== null}
          onClick={() => run('lock', 'Locked.', () => post('/api/admin/lock'))}
        >
          Lock
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="admin-note">{note}</p> : null}

      {/* ── accounts ─────────────────────────────────────────────────────── */}
      <section className="admin-section">
        <div className="admin-section-head">
          <span className="list-label" style={{ margin: 0 }}>
            Accounts
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setOnlySuspended((v) => !v)}
          >
            {onlySuspended ? 'Show all' : 'Only suspended'}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="hint">{onlySuspended ? 'Nobody is suspended.' : 'No accounts.'}</p>
        ) : null}

        {shown.map((a) => (
          <div key={a.id} className="admin-row">
            <div className="admin-row-main">
              <div className="admin-name">
                {a.displayName || a.username}{' '}
                <span className="admin-handle">@{a.username}</span>
              </div>
              <div className="admin-meta">
                {a.phone ? a.phone : 'no number'}
                {a.suspendedAt ? ' · suspended' : ''}
                {a.reviewRequestedAt ? ' · asked for review' : ''}
              </div>
              {a.suspendReason ? <div className="admin-why">{a.suspendReason}</div> : null}
            </div>

            <div className="admin-row-actions">
              {a.suspendedAt ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`re-${a.id}`, `Lifted the suspension on @${a.username}.`, () =>
                      post(`/api/admin/accounts/${a.id}/reinstate`)
                    )
                  }
                >
                  Reinstate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    const reason = window.prompt(
                      `Suspend @${a.username}?\n\nReason (shown to them, optional):`
                    );
                    // Cancelling must do nothing at all — an empty string is a deliberate
                    // "no reason", which is allowed, but null means the prompt was dismissed.
                    if (reason === null) return;
                    void run(`s-${a.id}`, `Suspended @${a.username}.`, () =>
                      post(`/api/admin/accounts/${a.id}/suspend`, { reason: reason.trim() })
                    );
                  }}
                >
                  Suspend
                </button>
              )}

              <button
                type="button"
                className="btn danger"
                disabled={busy !== null}
                onClick={() => {
                  // Typing the handle is the same confirmation the self-service route demands.
                  // Making the owner of the platform type it too is the difference between a
                  // decision and a mis-click next to the Reinstate button.
                  const typed = window.prompt(
                    `Delete @${a.username} permanently?\n\nTheir messages stay in the chats they were sent to. Type their username to confirm:`
                  );
                  if (typed === null) return;
                  void run(`d-${a.id}`, `Deleted @${a.username}.`, () =>
                    post(`/api/admin/accounts/${a.id}/delete`, { username: typed.trim() })
                  );
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── reports ──────────────────────────────────────────────────────── */}
      <section className="admin-section">
        <div className="admin-section-head">
          <span className="list-label" style={{ margin: 0 }}>
            Reports{openReports > 0 ? ` · ${openReports} open` : ''}
          </span>
        </div>

        {reports.length === 0 ? <p className="hint">Nothing reported.</p> : null}

        {reports.map((r) => (
          <div key={r.id} className="admin-row">
            <div className="admin-row-main">
              <div className="admin-name">
                {r.targetName} <span className="admin-handle">{r.kind}</span>
              </div>
              <div className="admin-meta">
                {r.reason}
                {r.note ? ` — ${r.note}` : ''}
              </div>
            </div>
            <div className="admin-row-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(`rc-${r.id}`, 'Report closed.', () =>
                    post(`/api/admin/reports/${r.id}/close`)
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── blocked numbers ──────────────────────────────────────────────── */}
      <section className="admin-section">
        <div className="admin-section-head">
          <span className="list-label" style={{ margin: 0 }}>
            Blocked numbers
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={busy !== null}
            onClick={() => {
              const phone = window.prompt('Block a number (include the country code):');
              if (phone === null || !phone.trim()) return;
              const reason = window.prompt('Reason (optional):') ?? '';
              void run('block', `${phone.trim()} is blocked.`, () =>
                post('/api/admin/blocked', { phone: phone.trim(), reason: reason.trim() })
              );
            }}
          >
            Block a number
          </button>
        </div>

        {blocked.length === 0 ? <p className="hint">No numbers blocked.</p> : null}

        {blocked.map((b) => (
          <div key={b.phone} className="admin-row">
            <div className="admin-row-main">
              <div className="admin-name">{b.phone}</div>
              {b.reason ? <div className="admin-why">{b.reason}</div> : null}
            </div>
            <div className="admin-row-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(`ub-${b.phone}`, `${b.phone} is unblocked.`, () =>
                    post('/api/admin/blocked/remove', { phone: b.phone })
                  )
                }
              >
                Unblock
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── what the owner has done ──────────────────────────────────────── */}
      <section className="admin-section">
        <div className="admin-section-head">
          <span className="list-label" style={{ margin: 0 }}>
            Recent actions
          </span>
        </div>

        {audit.length === 0 ? <p className="hint">Nothing done yet.</p> : null}

        {audit.map((e) => (
          <div key={e.id} className="admin-row">
            <div className="admin-row-main">
              <div className="admin-name">
                {e.action} <span className="admin-handle">{e.targetName}</span>
              </div>
              <div className="admin-meta">
                {new Date(e.at).toLocaleString()}
                {e.detail ? ` · ${e.detail}` : ''}
              </div>
            </div>
          </div>
        ))}
      </section>

      <AdminWipe />
    </div>
  );
}
