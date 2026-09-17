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
 * Lowercase letters and digits, with `-` and `_` allowed in the middle, ending in `-bot` or `_bot`,
 * and between 5 and 32 characters.
 *
 * THE SUFFIX IS THE POINT
 *
 * A handle that ends in `-bot` or `_bot` says what it is. It is the same convention Telegram
 * enforces, and it earns its place here for a different reason: this list is a person's own bots,
 * and a handle that names a machine is instantly distinguishable from a name they might have given
 * themselves. It also means the namespace is not shared with anything a future feature might want
 * to hand out as a human handle.
 *
 * The separator is required, so "supportbot" is refused and "support-bot" is not. The separator is
 * what makes the suffix readable as a suffix rather than as the end of a word — "robot" and
 * "talbot" are not bots, and a rule that accepted them would be a rule that mostly matched words
 * that merely happen to end that way.
 *
 * Anchored at both ends, so the pattern describes the whole value rather than a substring of it —
 * `/^…$/` and not `/[a-z]+/`, which would accept almost anything containing a letter. The leading
 * character class requires a letter or a digit first, so "-bot" on its own is refused, and the
 * middle group is written so a separator can neither lead nor be doubled: a handle is read next to
 * an @ and a stray separator reads as a typo.
 *
 * Five is the floor because the shortest thing that can satisfy the suffix is "a-bot". That falls
 * out of the pattern rather than being chosen, which is why it is derived from it below.
 */
export const BOT_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,26}[a-z0-9])?[-_]bot$/;

/** The ending every handle must have, as a test of its own so the message can be specific. */
export const BOT_HANDLE_SUFFIX = /[-_]bot$/;

/** The shortest a handle can be, given the required suffix: "a-bot". */
export const BOT_HANDLE_MIN = 5;

/** The longest, matching the pattern's quantifier. */
export const BOT_HANDLE_MAX = 32;

/** What to tell somebody whose handle was rejected. States the rules and shows a good example. */
export const BOT_HANDLE_HINT =
  'A username uses lowercase letters, digits, - and _, must end with -bot or _bot, is 5–32 characters, and cannot start or end with - or _ — for example support-bot.';

/** The specific message for the commonest mistake: a handle that is otherwise fine but un-botted. */
export const BOT_HANDLE_SUFFIX_HINT =
  'A username must end with -bot or _bot — for example support-bot.';

/** How many characters of the name's slug go before the appended suffix. */
const SLUG_CHARS = BOT_HANDLE_MAX - '-bot'.length;

/**
 * A first guess at a handle, from the bot's name.
 *
 * A guess and never a decision: the wizard puts it in the field so it can be edited, and the user
 * confirms it. Making it for them and hiding it would be handing somebody a name they did not
 * choose that cannot be changed later.
 *
 * The suffix is appended rather than expected, because the suggestion has to be a *valid* handle —
 * a pre-filled field that fails validation is worse than an empty one. A name that already ends in
 * the suffix does not get a second one: "Support Bot" becomes "support-bot", not
 * "support-bot-bot". That is what the strip-then-append does, and it is why the strip runs on the
 * slugged form rather than on the raw name.
 *
 * Runs of anything that is not a letter or a digit collapse to a single dash, which is what turns
 * "Support  Bot!" into "support-bot" rather than "support--bot-". It can still come back empty, for
 * a name with no letters or digits in it at all, and that is left as a visible problem for the user
 * to fix rather than padded with invented characters.
 */
export function suggestHandle(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  if (!slug) return '';

  // Strip an ending the user already gave us, then put exactly one back.
  const base = slug.replace(BOT_HANDLE_SUFFIX, '').replace(/[-_]+$/, '');
  if (!base) return '';

  return base.slice(0, SLUG_CHARS) + '-bot';
}

/**
 * What is wrong with this handle, or null if nothing is.
 *
 * Returns a sentence rather than a boolean, because every caller's next move is to show it. The
 * checks are ordered so the message is about the most basic thing wrong first: a blank field is
 * "required", not "does not match the pattern", even though both are true of it.
 *
 * The suffix is checked before the pattern, so the commonest mistake gets the sentence about the
 * suffix rather than the paragraph about every rule. Anybody who typed "support" needs to hear one
 * thing, and it is not the whole specification.
 */
export function describeHandleProblem(value: string): string | null {
  const handle = value.trim().toLowerCase();
  if (!handle) return 'A username is required.';
  if (!BOT_HANDLE_SUFFIX.test(handle)) return BOT_HANDLE_SUFFIX_HINT;
  if (handle.length < BOT_HANDLE_MIN) {
    return `A username is at least ${BOT_HANDLE_MIN} characters.`;
  }
  if (handle.length > BOT_HANDLE_MAX) {
    return `A username is ${BOT_HANDLE_MAX} characters or fewer.`;
  }
  if (!BOT_HANDLE_PATTERN.test(handle)) return BOT_HANDLE_HINT;
  return null;
}
