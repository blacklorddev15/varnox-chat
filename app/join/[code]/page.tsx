import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getConv, getInvite } from '@/lib/db';
import { refreshConv } from '@/lib/service';

export const dynamic = 'force-dynamic';

/** Invite links land here: sign in if needed, join the group, then open the app. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const me = await currentUser();
  if (!me) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

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
