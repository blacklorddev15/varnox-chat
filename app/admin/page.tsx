import { redirect } from 'next/navigation';
import { adminUnlocked, currentUser, isAdmin } from '@/lib/auth';
import { ensureSchema } from '@/lib/migrate';
import { listAccountsForAdmin, listAdminAudit, listBlockedPhones, listReports, openReportCount } from '@/lib/db';
import { AdminPanel } from '@/components/admin-panel';
import { AdminUnlock } from '@/components/admin-unlock';

export const dynamic = 'force-dynamic';

/**
 * The owner's control page.
 *
 * Gated twice, both on the server, at the point the data is read rather than at the point it is
 * drawn. The page being in the bundle, or the URL being known, gets an outsider nothing — this
 * function decides before any query runs.
 *
 * `ensureSchema` first, for the same reason /chat needs it: this page reads columns and tables
 * that nothing else would have reconciled on a cold instance whose first request is this one.
 */
export default async function AdminPage() {
  await ensureSchema();

  const me = await currentUser();
  if (!me) redirect('/login');

  // A plain refusal rather than a 404. The URL is not a secret — it is in the client bundle
  // either way — so pretending the page does not exist buys nothing and would leave the owner
  // staring at a "not found" on their own app with no clue which setting is wrong. What matters
  // is that no admin data is read for somebody not on the allowlist, and none is.
  if (!isAdmin(me)) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="admin-title">Admin control</div>
          <p className="hint" style={{ marginTop: 10 }}>
            This account is not an admin. To make it one, add its handle to <code>ADMIN_USERNAMES</code>{' '}
            in the environment and redeploy.
          </p>
          <p className="hint" style={{ margin: 0 }}>
            Your handle is @{me.username}.
          </p>
        </div>
      </div>
    );
  }

  if (!(await adminUnlocked())) return <AdminUnlock username={me.username} />;

  // Fetched together: four independent reads, and the page is useless until all four land.
  const [accounts, reports, blocked, audit, open] = await Promise.all([
    listAccountsForAdmin('all', 200),
    listReports('open', 100),
    listBlockedPhones(200),
    listAdminAudit(50),
    openReportCount(),
  ]);

  return (
    <AdminPanel
      me={{ username: me.username, displayName: me.displayName }}
      accounts={accounts}
      reports={reports}
      blocked={blocked}
      audit={audit}
      openReports={open}
    />
  );
}
