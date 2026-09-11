import { clearSessionCookie } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    await clearSessionCookie();
    return ok({ signedOut: true });
  });
}
