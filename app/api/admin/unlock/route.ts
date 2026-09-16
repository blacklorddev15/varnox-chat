import {
  checkAdminPassword,
  currentUser,
  isAdmin,
  setAdminUnlockCookie,
} from '@/lib/auth';
import { bad, handle, ok, readJsonBody } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Body = { password?: string };

/**
 * Enter the admin password.
 *
 * Deliberately NOT behind `requireAdmin()`. That now demands an unlock as well as the allowlist,
 * so requiring it here would make an unlock impossible to ever obtain — the gate would have no
 * door. The allowlist is checked directly instead, and the password is the thing under test,
 * which is exactly what this route exists to verify.
 *
 * One answer for a wrong password and for an account that is not on the allowlist. Two answers
 * would turn this into a way to ask which accounts are admins, and the list of admin accounts is
 * the last thing worth handing to anyone who can reach the page.
 *
 * The comparison is `verifyPassword` against a scrypt hash from the environment, so it is
 * constant-time and the stored value is not a password.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await currentUser();
    if (!me) return bad('Not signed in', 401);

    const body = await readJsonBody<Body>(req);
    const password = typeof body.password === 'string' ? body.password : '';

    // Both conditions together, so the reply cannot distinguish which one failed.
    if (!isAdmin(me) || !checkAdminPassword(password)) {
      return bad('That password is not correct', 403);
    }

    await setAdminUnlockCookie();
    return ok({ unlocked: true });
  });
}
