/**
 * The Varnox handle: what a username for a bot may look like, and how one is suggested.
 *
 * WHY THIS IS ITS OWN MODULE, WITH NO IMPORTS AT ALL
 *
 * Both sides of the wire need these rules. The route validates with them on the server, and the
 * wizard checks with them in the browser so a typo is answered instantly instead of after a round
 * trip. That only works if the module is safe to bundle for the browser — and importing it from
 * lib/bots.ts, where it would naturally live, is not: that module reaches the database, and a
 * client component importing it would drag `pg` and its sockets into the bundle and fail to build.
 *
 * So the rules live here, alone, with no dependency on anything. One definition, imported by both,
 * which is the point: two copies of a validation rule drift, and the copy that drifts is always the
 * one the user sees.
 *
 * The server remains the authority. describeHandleProblem() is a courtesy that saves a request, and
 * nothing is authorised on its answer.
 */

/**
 * What a handle may look like.
 *
 * Lowercase letters, digits, and - or _ between them, 3 to 32 characters, starting and ending with
 * a letter or a digit.
 *
 * Anchored at both ends, so the pattern describes the whole value rather than a substring of it —
 * `/^…$/` and not `/[a-z]+/`, which would accept almost anything containing a letter. The leading
 * and trailing classes are deliberately narrower than the middle one, so "support-bot" passes while
 * "-support" and "support-" do not: a handle is written next to an @ and read as a name, and a
 * leading separator reads as a typo.
 *
 * Three is the floor because one- and two-character strings have no room to differ, and a namespace
 * where "ab" and "ba" are both claimed runs out quickly.
 */
export const BOT_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/** The shortest and longest a handle can be, matching the pattern's quantifier. */
export const BOT_HANDLE_MIN = 3;
export const BOT_HANDLE_MAX = 32;

/** What to tell somebody whose handle was rejected. States the rules and shows a good example. */
export const BOT_HANDLE_HINT =
  'A username uses lowercase letters, digits, - and _, is 3–32 characters, and starts and ends with a letter or a digit — for example support-bot.';

/**
 * A first guess at a handle, from the bot's name.
 *
 * A guess and never a decision: the wizard puts it in the field so it can be edited, and the user
 * confirms it. Making it for them and hiding it would be handing somebody a name they did not
 * choose that cannot be changed later.
 *
 * Runs of anything that is not a letter or a digit collapse to a single dash, which is what turns
 * "Support  Bot!" into "support-bot" rather than "support--bot-". The result is then trimmed of
 * dashes at either end, because a name of entirely punctuation — "!!!" — would otherwise start
 * with one. It can still come back shorter than the minimum, or empty, and that is left as a
 * visible problem for the user to fix rather than padded with invented characters.
 */
export function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, BOT_HANDLE_MAX);
}

/**
 * What is wrong with this handle, or null if nothing is.
 *
 * Returns a sentence rather than a boolean, because every caller's next move is to show it. The
 * checks are ordered so the message is about the most basic thing wrong first: a blank field is
 * "required", not "does not match the pattern", even though both are true of it.
 */
export function describeHandleProblem(value: string): string | null {
  const handle = value.trim().toLowerCase();
  if (!handle) return 'A username is required.';
  if (handle.length < BOT_HANDLE_MIN) {
    return `A username is at least ${BOT_HANDLE_MIN} characters.`;
  }
  if (handle.length > BOT_HANDLE_MAX) {
    return `A username is ${BOT_HANDLE_MAX} characters or fewer.`;
  }
  if (!BOT_HANDLE_PATTERN.test(handle)) return BOT_HANDLE_HINT;
  return null;
}
