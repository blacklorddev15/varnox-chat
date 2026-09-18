import { bad, clean, clientIp, deviceLabel, handle, ok, readJsonBody, userAgent } from '@/lib/api';
import {
  createDevice,
  getUserByEmail,
  getUserByPhone,
  getUserByUsername,
  isAccountSuspended,
} from '@/lib/db';
import { publicUser, signClientToken, verifyPassword } from '@/lib/auth';
import { normaliseEmail } from '@/lib/email';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

type Body = { identifier?: string; password?: string };

/**
 * POST /api/v1/auth/login — sign an app in and hand it tokens.
 *
 * Resolves the identifier the same way the web sign-in does — a number if it looks like one, then
 * an address, then a username — so an identifier means the same thing on both doors.
 *
 * One sentence for every failure, as the rest of /api/v1 does. A client that could tell a wrong
 * password from an account that does not exist is a client that can be used to enumerate accounts.
 *
 * The device is created here rather than the token being self-contained, and that is the design:
 * a native install becomes a row in vx_devices like any browser, so revoking it, listing it, and
 * signing it out from elsewhere all keep working without a second session store to keep in step.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJsonBody<Body>(req);
    const raw = clean(body.identifier, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!raw || !password) return bad('Enter your details and password');

    const phone = normalisePhone(raw);
    const email = normaliseEmail(raw);
    const user =
      (phone ? await getUserByPhone(phone) : null) ??
      (email ? await getUserByEmail(email) : null) ??
      (await getUserByUsername(raw));

    if (!user || !verifyPassword(password, user.pwHash)) {
      return bad('Incorrect phone number, email or password', 401);
    }
    if (await isAccountSuspended(user.id)) {
      return bad('This account can no longer use the Varnox app', 403);
    }

    const device = await createDevice(user.id, {
      label: deviceLabel(req),
      userAgent: userAgent(req),
      ip: clientIp(req),
    });

    return ok({
      accessToken: signClientToken(user.id, device.id, 'access'),
      refreshToken: signClientToken(user.id, device.id, 'refresh'),
      expiresIn: 12 * 3600,
      deviceId: device.id,
      user: publicUser(user),
    });
  });
}
