import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { currentUser, isAdmin, publicUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { ensureSchema } from '@/lib/migrate';
import { SuspendedScreen } from '@/components/suspended-screen';
import type { PublicUser } from '@/lib/types';

/**
 * The gate every signed-in page shares.
 *
 * It was inlined in /chat, and /chat comments each part: reconcile before reading, because a cold
 * instance whose first request is a page rather than an API call would otherwise read a column
 * that does not exist yet; check suspension here as well as in requireUser(), because a page
 * renders from the session alone and a suspended account would otherwise be handed the whole app
 * and discover the suspension one failed action at a time.
 *
 * It is a shared function now that five more pages need it. Six copies of a lockout check is six
 * places for the lockout to be wrong, and this is the one check that must never drift.
 *
 * Deletion needs no branch: currentUser() returns null for a deleted account, so the redirect
 * below already covers it.
 */
export type PageGate =
  | { ok: true; me: PublicUser; isAdmin: boolean }
  | { ok: false; screen: ReactElement };

export async function pageGate(): Promise<PageGate> {
  await ensureSchema();

  const me = await currentUser();
  if (!me) redirect('/login');

  const suspension = await getSuspension(me.id);
  if (suspension) return { ok: false, screen: <SuspendedScreen suspension={suspension} /> };

  return { ok: true, me: publicUser(me), isAdmin: isAdmin(me) };
}
