import { currentUser, hashPassword, publicUser, setSessionCookie } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUserByUsername, reserveUsername, saveUser, usernameTaken } from '@/lib/db';
import { newId } from '@/lib/blob';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Body = {
  username?: string;
  displayName?: string;
  password?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const username = clean(body.username, 24).toLowerCase().replace(/\s+/g, '');
    const displayName = clean(body.displayName, 40) || username;
    const password = String(body.password ?? '');

    if (!/^[a-z0-9._]{3,24}$/.test(username)) {
      return bad('Username must be 3-24 characters: letters, numbers, dot or underscore');
    }
    if (password.length < 6) return bad('Password must be at least 6 characters');
    if (await usernameTaken(username)) return bad('That username is already taken', 409);

    const existing = await getUserByUsername(username);
    if (existing) return bad('That username is already taken', 409);

    const user: User = {
      id: newId('u'),
      username,
      displayName,
      about: 'Hey there! I am using Varnox.',
      avatar: null,
      pwHash: hashPassword(password),
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };

    await reserveUsername(username, user.id);
    await saveUser(user);
    await setSessionCookie(user.id);

    return ok({ user: publicUser(user) }, 201);
  });
}

export async function GET() {
  return handle(async () => {
    const me = await currentUser();
    return ok({ user: me ? publicUser(me) : null });
  });
}
