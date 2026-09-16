import { publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { bad, clean, clientIp, deviceLabel, handle, ok, readJsonBody, userAgent } from '@/lib/api';
import {
  createDevice,
  getUserByEmail,
  getUserByPhone,
  getUserByUsername,
  isAccountDeleted,
  saveUser,
} from '@/lib/db';
import { normaliseEmail } from '@/lib/email';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = {
  /** phone number, email address or handle */
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
    if (!raw) return bad('Enter your phone number, email or username');

    // One field accepts all three identifiers. Each lookup only runs when the input can
    // actually be that kind of identifier, so a handle containing "@" is not mistaken for
    // an address and a mistyped number still falls through to the username check.
    const phone = normalisePhone(raw);
    const email = normaliseEmail(raw);
    const user =
      (phone ? await getUserByPhone(phone) : null) ??
      (email ? await getUserByEmail(email) : null) ??
      (await getUserByUsername(raw));

    if (!user || !verifyPassword(password, user.pwHash)) {
      return bad('Incorrect phone number, email or password', 401);
    }

    // A deleted account answers exactly like a wrong password. Saying "this account was deleted"
    // would confirm a number or handle that somebody has just walked away from.
    if (await isAccountDeleted(user.id)) {
      return bad('Incorrect phone number, email or password', 401);
    }

    const fresh = { ...user, lastSeen: Date.now() };
    await saveUser(fresh);
    // A sign-in is a device too, so it shows up in Linked devices and can be revoked from
    // another one rather than living on as an invisible session.
    const device = await createDevice(user.id, {
      label: deviceLabel(req),
      userAgent: userAgent(req),
      ip: clientIp(req),
    });
    await setSessionCookie(user.id, device.id);
    return ok({ user: publicUser(fresh) });
  });
}
