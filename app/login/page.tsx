import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { AuthScreen } from '@/components/auth-screen';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const me = await currentUser();
  if (me) redirect('/chat');
  return <AuthScreen />;
}
