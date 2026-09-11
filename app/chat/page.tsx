import { redirect } from 'next/navigation';
import { currentUser, publicUser } from '@/lib/auth';
import { Messenger } from '@/components/messenger';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  return <Messenger me={publicUser(me)} />;
}
