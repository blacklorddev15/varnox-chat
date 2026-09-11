import {
  currentUser,
  handleFromPhone,
  hashPassword,
  publicUser,
  setSessionCookie,
} from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { getUserByUsername, phoneTaken, reservePhone, reserveUsername, saveUser, usernameTaken } from '@/lib/db';
import { rand, newId } from '@/lib/blob';
import { formatPhone, normalisePhone } from '@/lib/phone';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Body = {
  phone?: string;
  username?: string;
  displayName?: string;
  password?: string;
};

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const password = String(body.password ?? '');
    if (password.length < 6) return bad('Password must be at least 6 characters');

    const rawPhone = clean(body.phone, 30);
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      return bad('Enter a valid phone number including country code, e.g. +65 9123 4567');
    }
    if (phone && (await phoneTaken(phone))) {
      return bad('That phone number is already registered', 409);
    }

    const requested = clean(body.username, 24).toLowerCase().replace(/\s+/g, '');
    let wanted = requested || (phone ? handleFromPhone(phone) : '');
    if (!wanted) return bad('Enter a phone number to register');
    if (!/^[a-z0-9._]{3,24}$/.test(wanted)) {
      return bad('Handle must be 3-24 characters: letters, numbers, dot or underscore');
    }

    if ((await usernameTaken(wanted)) || (await getUserByUsername(wanted))) {
      // An explicitly chosen handle must stay exactly as asked for, because that is
      // also how those accounts sign in. Handles derived from a phone number are
      // internal, so a free variant can be picked silently.
      if (requested) return bad('That username is already taken', 409);
      let candidate = '';
      for (let i = 0; i < 5; i++) {
        candidate = `${wanted.slice(0, 18)}${rand(3)}`.slice(0, 24);
        if (!(await usernameTaken(candidate)) && !(await getUserByUsername(candidate))) break;
        candidate = '';
      }
      if (!candidate) return bad('That handle is already taken', 409);
      wanted = candidate;
    }

    const user: User = {
      id: newId('u'),
      username: wanted,
      phone,
      displayName: clean(body.displayName, 40) || (phone ? formatPhone(phone) : wanted),
      about: 'Hey there! I am using Varnox.',
      avatar: null,
      pwHash: hashPassword(password),
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };

    if (phone) await reservePhone(phone, user.id);
    await reserveUsername(wanted, user.id);
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
