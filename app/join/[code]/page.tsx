import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getConv, getInvite, getSuspension } from '@/lib/db';
import { refreshConv } from '@/lib/service';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

/** Invite links land here: sign in if needed, join the group, then open the app. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const me = await currentUser();
  if (!me) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  /**
   * Checked before anything else, because this page is not just a view — it writes.
   *
   * Joining adds this account to the group's member list, which every other member then sees, so
   * a suspended account must not reach that line. `requireUser()` refuses a suspended account,
   * but this page is rendered from the session without going through it, so the gate has to be
   * repeated here. Without it a suspended account could still pull an invite link, join the
   * group, and only then be shown the banner — having already changed a roster other people read.
   */
  const suspension = await getSuspension(me.id);
  if (suspension) return <SuspendedScreen suspension={suspension} />;

  const invite = await getInvite(code);
  if (!invite) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Invite not valid</h1>
          <p className="sub">
            This group invite link has expired or never existed. Ask the person who sent it for a
            fresh link.
          </p>
          <Link className="btn" href="/chat" style={{ display: 'block', textAlign: 'center' }}>
            Open Varnox
          </Link>
        </div>
      </div>
    );
  }

  const conv = await getConv(invite.convId);
  if (!conv) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Group unavailable</h1>
          <p className="sub">That group no longer exists.</p>
          <Link className="btn" href="/chat" style={{ display: 'block', textAlign: 'center' }}>
            Open Varnox
          </Link>
        </div>
      </div>
    );
  }

  if (!conv.members.includes(me.id)) {
    await refreshConv({ ...conv, members: [...conv.members, me.id] });
  }

  redirect('/chat');
}
