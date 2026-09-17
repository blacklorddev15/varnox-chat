import { cookies } from 'next/headers';
import {
  currentUser,
  handleFromPhone,
  hashPassword,
  publicUser,
  setSessionCookie,
} from '@/lib/auth';
import { bad, clean, clientIp, deviceLabel, handle, ok, readJsonBody, userAgent } from '@/lib/api';
import {
  clearEmailCode,
  createDevice,
  emailRecentlyConfirmed,
  emailTaken,
  getUserByUsername,
  isPhoneBlocked,
  linkOauthIdentity,
  oauthUserId,
  phoneTaken,
  reservePhone,
  reserveUsername,
  saveUser,
  usernameTaken,
} from '@/lib/db';
import { normaliseEmail } from '@/lib/email';
import { GOOGLE_TICKET_COOKIE, verifyGoogleTicket } from '@/lib/google';
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

    /**
     * The Google claim, if this signup began at Google. Read here rather than at the point of use
     * so that the number can be required below — before anything has been created — and so the
     * cookie is spent once for this request rather than read twice.
     */
    const jar = await cookies();
    const ticket = verifyGoogleTicket(jar.get(GOOGLE_TICKET_COOKIE)?.value);

    const rawPhone = clean(body.phone, 30);
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      return bad('Enter a valid phone number including country code, e.g. +65 9123 4567');
    }
    /**
     * Refused plainly here, unlike at /api/auth/otp/start, and the difference is intentional.
     *
     * That endpoint is a probe — anyone can call it for any number — so it must not say whether
     * a number is blocked. This one is somebody asserting an identity and creating state, and a
     * vague error would only send them round the same form again. Checked before the
     * already-registered test so a blocked number cannot be used to work out whether it is also
     * registered.
     */
    if (phone && (await isPhoneBlocked(phone))) {
      return bad('This phone number cannot be used to create an account', 403);
    }

    if (phone && (await phoneTaken(phone))) {
      return bad('That phone number is already registered', 409);
    }

    /**
     * Signing up through Google still needs a number, and this is where that stops being a
     * property of the signup screen and becomes one of the server.
     *
     * It matters because a username alone is enough to create an account here, with no number at
     * all. Without this check a caller holding a Google ticket could therefore skip the number —
     * and the block list that is consulted against it — while still collecting the link. Refusing
     * costs a real visitor nothing: the wizard has just collected their number on the step before.
     */
    if (ticket && !phone) {
      return bad('A phone number is required to finish signing up with Google');
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

      /**
       * An address is accepted here only if the wizard already proved it.
       *
       * The code is entered before this account exists, so the proof cannot live on the account —
       * it lives in vx_email_codes, as the consumed row verifyEmailCode() leaves behind. Without
       * this the address would be what it used to be: a string anybody could type for anybody
       * else, stored on the account as though somebody had checked it.
       */
      if (!(await emailRecentlyConfirmed(email))) {
        return bad('Confirm your email address first — request a code and enter it', 403);
      }
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
      // Proved a moment ago, in the wizard, before this row existed — which is why the check
      // above can be a requirement rather than a hope. An account registered without an address
      // keeps this null and can have one added and confirmed later from the profile screen.
      emailVerifiedAt: email ? Date.now() : null,
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

    /**
     * Attach a Google account, when this signup began with one.
     *
     * The claim arrives in an httpOnly cookie the callback set rather than in the request body,
     * so the browser never handles it as a value and it never appears in a URL.
     *
     * This happens *here* rather than during the callback, and that placement is the whole
     * design: the number above has just been through the same checks everybody else's number
     * goes through, including the block list. A Google signup therefore cannot reach an account
     * that a phone signup could not, and there is no second account-creation path that would
     * have to remember to repeat those checks.
     *
     * Guarded rather than assumed: the ticket has to verify (it is signed and expires), and the
     * identity must not already belong to another account. Failure to link is logged and then
     * swallowed on purpose — the account exists and the session cookie is about to be set, so
     * an unusable Google link is a small loss next to failing a signup that has already
     * reserved a number and a handle.
     */
    if (ticket) {
      // Spent once. Cleared before the link is attempted, so a failure cannot leave a live
      // ticket behind for a later signup to pick up.
      jar.set(GOOGLE_TICKET_COOKIE, '', { path: '/', maxAge: 0 });
      try {
        const held = await oauthUserId('google', ticket.sub);
        if (!held) {
          await linkOauthIdentity({
            provider: 'google',
            providerUserId: ticket.sub,
            userId: user.id,
            email: ticket.email,
          });
        } else if (held !== user.id) {
          console.warn('[varnox] google identity already linked; leaving it where it is');
        }
      } catch (err) {
        console.error(
          '[varnox] could not link google identity:',
          err instanceof Error ? err.message : err
        );
      }
    }

    // Every sign-in becomes a device, not just a linked one, so the device list is a complete
    // picture and any of them can be signed out from another.
    const device = await createDevice(user.id, {
      label: deviceLabel(req),
      userAgent: userAgent(req),
      ip: clientIp(req),
    });
    await setSessionCookie(user.id, device.id);

    /**
     * No code is sent from here any more, and none needs to be: the address was proved before this
     * account existed. The row that proved it is dropped so it cannot be presented a second time
     * — the proof is single-use in the same way the code itself was.
     */
    if (email) await clearEmailCode(email);

    return ok({ user: publicUser(user) }, 201);
  });
}

export async function GET() {
  return handle(async () => {
    const me = await currentUser();
    return ok({ user: me ? publicUser(me) : null });
  });
}
