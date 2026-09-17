import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { googleConfigured, safeNextPath } from '@/lib/google';
import { AuthScreen } from '@/components/auth-screen';
import { Welcome } from '@/components/welcome';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; google?: string; signin?: string; mode?: string }>;
}) {
  const me = await currentUser();
  // `google` is how the callback reports back — the reason to explain, when there is one. Read
  // here rather than in the client so the screen has it on its first render and does not flash
  // a form it is about to leave.
  const { next, google, signin, mode } = await searchParams;

  /**
   * `next` arrives in the query string, so it is checked rather than trusted — and checked with
   * the same helper the Google flow uses, so there is one place to get this right instead of two
   * similar-looking tests that can drift apart. This page previously used a bare
   * `startsWith('/')`, which lets `/\evil.com` through: browsers read a backslash as a slash, so
   * that value is protocol-relative and would have left the site.
   *
   * The origin comes from the forwarded headers because a server component has no request URL to
   * read. If those headers are missing the origin is empty, the helper refuses everything, and
   * the visitor lands on /chat — a fallback that loses a redirect rather than allowing one.
   */
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const origin = host
    ? `${requestHeaders.get('x-forwarded-proto') ?? 'https'}://${host}`
    : '';
  const destination = safeNextPath(next, origin);

  if (me) redirect(destination || '/chat');

  /**
   * The welcome screen is the default: somebody opening the app should be offered a way in, not
   * a form.
   *
   * `signin` is the unadvertised way back for anyone who already has an account — every account
   * in this database predates the welcome screen, so without it they would have no route to the
   * sign-in form at all. See the note in components/welcome.tsx.
   *
   * `mode=register` is what Get Started carries, so the screen opens the wizard rather than the
   * sign-in half of the same component.
   */
  if (!signin) return <Welcome />;

  return (
    <AuthScreen
      next={destination}
      google={google}
      startRegister={mode === 'register'}
      // Decided here because the answer comes from the server's environment, not the browser's.
      googleReady={googleConfigured()}
    />
  );
}
