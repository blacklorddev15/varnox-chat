import { publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUserByUsername, saveUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<{ username?: string; password?: string }>(req);
    const username = clean(body.username, 24).toLowerCase();
    const password = String(body.password ?? '');

    const user = await getUserByUsername(username);
    if (!user || !verifyPassword(password, user.pwHash)) {
      return bad('Incorrect username or password', 401);
    }

    const fresh = { ...user, lastSeen: Date.now() };
    await saveUser(fresh);
    await setSessionCookie(user.id);
    return ok({ user: publicUser(fresh) });
  });
}
