/**
 * What a suspension means right now.
 *
 * The owner asked for a ladder: an account that never appeals stays banned; an appeal brings the
 * account back after five hours; and that same appeal drops the suspension entirely after a week.
 *
 * All of it is derived from two timestamps rather than stored as a status. A status would have to
 * be moved by something, and the only something this deployment has is a request — so an account
 * would sit in the wrong state until somebody happened to open the app, and a user whose hour had
 * come would be told they were still banned by a server that simply had not looked recently.
 * Deriving it means the answer is right whenever it is asked, with no job to schedule, nothing to
 * miss while the service is down, and no stored state that can disagree with the clock.
 *
 * The two columns already existed: `vx_users.suspended_at` and the review request the suspension
 * screen has been writing all along. What is new here is reading them as a ladder instead of as a
 * flag.
 */

/** How long after asking for a review the account becomes usable again. */
export const APPEAL_TEMPORARY_MS = 5 * 60 * 60_000;

/** How long after asking for a review the suspension is dropped entirely. */
export const APPEAL_CLEAR_MS = 7 * 24 * 60 * 60_000;

export type SuspensionState =
  /** Never suspended — or suspended and since cleared. */
  | 'clear'
  /** Suspended and not appealed. The account cannot be used, and will not be until they appeal. */
  | 'banned'
  /** Appealed, and the wait is not over. Still cannot be used. */
  | 'waiting'
  /** Appealed and past the wait. Usable again, but the suspension still stands on the record. */
  | 'temporary'
  /** Appealed and past the week. No longer suspended at all. */
  | 'restored';

/**
 * The rung of the ladder, given the two timestamps and the time now.
 *
 * `reviewAt` is when the owner last asked for a review, which is the start of both clocks — so a
 * second request restarts them, which is the sensible reading of asking again.
 *
 * Boundaries belong to the later rung: at exactly five hours the account is usable, because the
 * wait the screen promised has been served. An off-by-one that kept somebody banned for an extra
 * tick on a promise the app itself made would be indistinguishable, to them, from the promise
 * being a lie.
 */
export function suspensionState(
  suspendedAt: number | null,
  reviewAt: number | null,
  now = Date.now()
): SuspensionState {
  if (suspendedAt == null) return 'clear';
  if (reviewAt == null) return 'banned';

  const waited = now - reviewAt;
  if (waited < APPEAL_TEMPORARY_MS) return 'waiting';
  if (waited < APPEAL_CLEAR_MS) return 'temporary';
  return 'restored';
}

/** Whether the account may be used at all. */
export function suspensionBlocksUse(state: SuspensionState): boolean {
  return state === 'banned' || state === 'waiting';
}

/**
 * Whether the account must sign in again.
 *
 * A restored account is not waved back in on whatever session it still happens to hold. Coming off
 * a ban is exactly the moment to establish that the account is still the person holding it, so the
 * temporary and restored rungs ask for a fresh sign-in: email, password, and then a code to the
 * address on file.
 */
export function suspensionNeedsFreshSignIn(state: SuspensionState): boolean {
  return state === 'temporary' || state === 'restored';
}

/** How long until the account becomes usable, for a screen that wants to say so. */
export function msUntilUsable(reviewAt: number | null, now = Date.now()): number {
  if (reviewAt == null) return 0;
  return Math.max(0, reviewAt + APPEAL_TEMPORARY_MS - now);
}
