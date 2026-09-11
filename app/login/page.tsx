import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { AuthScreen } from '@/components/auth-screen';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const me = await currentUser();
  const { next } = await searchParams;
  if (me) redirect(next && next.startsWith('/') ? next : '/chat');
  return <AuthScreen next={next && next.startsWith('/') ? next : undefined} />;
}
