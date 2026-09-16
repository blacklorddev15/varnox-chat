import { currentUser, publicUser, requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import {
  emailTaken,
  getSuspension,
  getUserByPhone,
  isPhoneBlocked,
  releasePhone,
  reservePhone,
  saveUser,
} from '@/lib/db';
import { normaliseEmail } from '@/lib/email';
import { normalisePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const me = await currentUser();
    if (!me) return ok({ user: null, suspension: null });
    // Returned beside the user rather than inside it. PublicUser is the shape that describes
    // *other* people as well, and whether an account is suspended is nobody else's business —
    // putting it in that projection would leak it through search, member lists and chat rows.
    return ok({ user: publicUser(me), suspension: await getSuspension(me.id) });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<{
      displayName?: string;
      about?: string;
      avatar?: string | null;
      phone?: string;
      email?: string | null;
    }>(req);

    const next = { ...me, lastSeen: Date.now() };
    if (body.displayName !== undefined) {
      const name = clean(body.displayName, 40);
      if (name) next.displayName = name;
    }
    if (body.about !== undefined) next.about = clean(body.about, 140);
    if (body.avatar !== undefined) {
      next.avatar = body.avatar ? clean(body.avatar, 500) : null;
    }

    if (body.phone !== undefined && clean(body.phone, 30) !== (me.phone ?? '')) {
      const raw = clean(body.phone, 30);
      const phone = normalisePhone(raw);
      if (!phone) return bad('Enter a valid phone number including country code');
      if (phone !== me.phone) {
        // A fourth place a phone number can be written, and the one the blocklist first missed.
        // Without this a blocked number is still claimable — by the account being blocked, or by
        // anybody else who wants a number that is meant to be out of circulation.
        if (await isPhoneBlocked(phone)) {
          return bad('That phone number cannot be used', 403);
        }
        const holder = await getUserByPhone(phone);
        if (holder && holder.id !== me.id) {
          return bad('That phone number is already registered', 409);
        }
        if (me.phone) await releasePhone(me.phone);
        await reservePhone(phone, me.id);
        next.phone = phone;
      }
    }

    if (body.email !== undefined) {
      const cleaned = clean(body.email, 254);
      if (!cleaned) {
        // An empty string clears the address, which the partial unique index allows.
        next.email = null;
      } else {
        const email = normaliseEmail(cleaned);
        if (!email) return bad('Enter a valid email address, for example you@example.com');
        if (email !== me.email) {
          if (await emailTaken(email)) return bad('That email is already registered', 409);
          next.email = email;
        }
      }
    }

    await saveUser(next);
    return ok({ user: publicUser(next) });
  });
}
