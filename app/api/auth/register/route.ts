import {
  currentUser,
  handleFromPhone,
  hashPassword,
  publicUser,
  setSessionCookie,
} from '@/lib/auth';
import { bad, clean, clientIp, deviceLabel, handle, ok, readJsonBody, userAgent } from '@/lib/api';
import {
  createDevice,
  emailTaken,
  getUserByUsername,
  phoneTaken,
  reservePhone,
  reserveUsername,
  saveUser,
  usernameTaken,
} from '@/lib/db';
import { normaliseEmail } from '@/lib/email';
import { rand, newId } from '@/lib/ids';
import { formatPhone, normalisePhone } from '@/lib/phone';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Body = {
  phone?: string;
  email?: string;
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

    // The address is optional during signup and can be added later from the profile screen.
    // When one is given it is stored lowercased and checked case-insensitively, the same
    // rule the unique index enforces.
    const rawEmail = clean(body.email, 254);
    let email: string | null = null;
    if (rawEmail) {
      email = normaliseEmail(rawEmail);
      if (!email) return bad('Enter a valid email address, for example you@example.com');
      if (await emailTaken(email)) return bad('That email is already registered', 409);
    }

    // The username is the handle people search for, so a chosen one is validated explicitly
    // and a taken one is rejected outright rather than silently replaced.
    const requested = clean(body.username, 24).trim().toLowerCase();
    let wanted = requested;
    if (requested) {
      if (!/^[a-z0-9._]{3,20}$/.test(requested)) {
        return bad('Username must be 3-20 characters: letters, numbers, dot or underscore');
      }
      if ((await usernameTaken(requested)) || (await getUserByUsername(requested))) {
        return bad('That username is already taken', 409);
      }
      wanted = requested;
    } else {
      wanted = phone ? handleFromPhone(phone) : '';
      if (!wanted) return bad('Enter a phone number to register');
      if (!/^[a-z0-9._]{3,24}$/.test(wanted)) {
        return bad('Handle must be 3-24 characters: letters, numbers, dot or underscore');
      }
      if ((await usernameTaken(wanted)) || (await getUserByUsername(wanted))) {
        // A handle derived from a phone number is internal, so a free variant can be
        // picked silently. An explicitly chosen handle must stay exactly as asked for,
        // because that is also how those accounts sign in.
        let candidate = '';
        for (let i = 0; i < 5; i++) {
          candidate = `${wanted.slice(0, 18)}${rand(3)}`.slice(0, 24);
          if (!(await usernameTaken(candidate)) && !(await getUserByUsername(candidate))) break;
          candidate = '';
        }
        if (!candidate) return bad('That handle is already taken', 409);
        wanted = candidate;
      }
    }

    const user: User = {
      id: newId('u'),
      username: wanted,
      phone,
      email,
      // A username someone chose is the friendliest thing to show next to their messages; a
      // generated handle is not, so that case falls back to the number instead.
      displayName:
        clean(body.displayName, 40) ||
        (clean(body.username, 24) ? wanted : phone ? formatPhone(phone) : wanted),
      about: 'Hey there! I am using Varnox.',
      avatar: null,
      pwHash: hashPassword(password),
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };

    if (phone) await reservePhone(phone, user.id);
    await reserveUsername(wanted, user.id);
    await saveUser(user);

    // Every sign-in becomes a device, not just a linked one, so the device list is a complete
    // picture and any of them can be signed out from another.
    const device = await createDevice(user.id, {
      label: deviceLabel(req),
      userAgent: userAgent(req),
      ip: clientIp(req),
    });
    await setSessionCookie(user.id, device.id);

    return ok({ user: publicUser(user) }, 201);
  });
}

export async function GET() {
  return handle(async () => {
    const me = await currentUser();
    return ok({ user: me ? publicUser(me) : null });
  });
}
