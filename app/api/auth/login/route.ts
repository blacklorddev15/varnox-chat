import { publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUserByPhone, getUserByUsername, saveUser } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = {
  /** phone number or handle */
  identifier?: string;
  /** older clients sent this field */
  username?: string;
  password?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const raw = clean(body.identifier ?? body.username, 40);
    const password = String(body.password ?? '');
    if (!raw) return bad('Enter your phone number');

    const phone = normalisePhone(raw);
    const user = (phone ? await getUserByPhone(phone) : null) ?? (await getUserByUsername(raw));

    if (!user || !verifyPassword(password, user.pwHash)) {
      return bad('Incorrect phone number or password', 401);
    }

    const fresh = { ...user, lastSeen: Date.now() };
    await saveUser(fresh);
    await setSessionCookie(user.id);
    return ok({ user: publicUser(fresh) });
  });
}
