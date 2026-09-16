import { handleFromPhone, passwordlessHash, publicUser, setSessionCookie } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import {
  findUserByPhone,
  getUserByPhone,
  reservePhone,
  reserveUsername,
  saveUser,
  unconsumeOtp,
  usernameTaken,
} from '@/lib/db';
import { newId, rand } from '@/lib/ids';
import { verifyOtp } from '@/lib/otp';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { phone?: string; code?: string };

/** A handle derived from the number, stepped aside if someone already holds it. */
async function freeHandle(phone: string): Promise<string> {
  const base = handleFromPhone(phone);
  if (!(await usernameTaken(base))) return base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = base + rand(3);
    if (!(await usernameTaken(candidate))) return candidate;
  }
  return base + rand(6);
}

/**
 * POST /api/auth/otp/verify — check the code and sign the caller in.
 *
 * A number that has never been seen and whose code checks out becomes an account: the
 * number is the identity and the code is the proof, so there is no separate registration
 * step and no password to choose. Legacy password accounts are untouched and can still
 * sign in at /api/auth/login.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const phone = normalisePhone(clean(body.phone, 24));
    const code = clean(body.code, 12).replace(/\D/g, '');

    if (!phone) return bad('Enter a valid phone number, including the country code');
    if (code.length !== 6) return bad('Enter the 6-digit code from the SMS');

    const result = await verifyOtp(phone, code);
    if (!result.ok) return bad(result.error, result.status);

    let user = await findUserByPhone(phone);
    let created = false;

    // A number already reserved by another account gets no session. reservePhone() is
    // do-nothing rather than do-update, so this can never quietly reassign a reservation.
    const holder = await getUserByPhone(phone);
    if (holder && holder.id !== user?.id) {
      return bad('That number is already linked to another account', 409);
    }

    try {
      if (!user) {
        const id = newId('u');
        const username = await freeHandle(phone);
        const displayName = phone; // replaced when the user names themselves after setup
        user = {
          id,
          username,
          phone,
          // No address yet: this route signs in with a code, and the profile screen is
          // where an email gets added.
          email: null,
          displayName,
          about: '',
          avatar: null,
          pwHash: passwordlessHash(),
          createdAt: Date.now(),
          lastSeen: Date.now(),
        };
        await saveUser(user);
        await reserveUsername(username, id);
        await reservePhone(phone, id);
        created = true;
      } else {
        // An account that predates phone login may have the number without the index row.
        // Claiming it here keeps discovery working and prevents a second account later.
        if (!(await getUserByPhone(phone))) await reservePhone(phone, user.id);
        const fresh = { ...user, phone, lastSeen: Date.now() };
        await saveUser(fresh);
        user = fresh;
      }
    } catch (err) {
      // verifyOtp already spent the code, so a failure here would cost the user an SMS for
      // nothing. Hand that exact code back — not whatever code the row holds now.
      await unconsumeOtp(phone, result.codeHash);
      throw err;
    }

    if (!user) return bad('Could not sign you in. Please try again.', 500);

    await setSessionCookie(user.id);
    return ok({ user: publicUser(user), created });
  });
}
