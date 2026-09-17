import crypto from 'node:crypto';

/**
 * Varnox API tokens for bots: how one is minted, and how a presented one is checked.
 *
 * Deliberately free of any import beyond node:crypto. Everything here is a pure function of its
 * arguments, so the properties that matter — the token is unpredictable, the stored value is a
 * hash and not the token, a wrong token never compares equal — can be tested without a database,
 * a request, or a running Next server. That is the point of the split: the rules that are worth
 * proving are not mixed in with the code that fetches rows.
 *
 * WHY THIS IS NOT A PASSWORD HASH
 *
 * lib/auth.ts hashes account passwords with scrypt. This does not, and the difference is
 * deliberate rather than an oversight.
 *
 * A password is short, human-chosen, and often drawn from a small set of likely candidates, so
 * the only defence against someone who has stolen the hashes is to make each guess expensive.
 * A Varnox token is 32 bytes straight from the system CSPRNG. There is no list of likely
 * candidates to run through, so a work factor has nothing to slow down — while the cost would
 * be paid on every single verification, forever, against a secret that needs no help. A plain
 * SHA-256 is the right tool for a value that is already uniformly random and long.
 *
 * (A general-purpose hash is unsafe for passwords precisely because they are guessable. That
 * condition does not hold here.)
 */

/**
 * The visible prefix.
 *
 * It exists so a token is recognisable in a log, a bug report or a screenshot for what it is —
 * the same reason a card number is grouped — and so a scanner can be told to look for it. It is
 * not part of the secret and is not stripped before hashing.
 */
export const BOT_TOKEN_PREFIX = 'vx_';

/** 32 bytes, i.e. 256 bits of entropy. base64url renders that as 43 characters, unpadded. */
const SECRET_BYTES = 32;

/** What 32 random bytes look like in base64url: 43 characters, no padding. */
const SECRET_CHARS = 43;

/**
 * Mint a token.
 *
 * crypto.randomBytes, never Math.random. Math.random is seeded from a value an observer can
 * often narrow down and its output can be predicted from a handful of earlier outputs, so a
 * token drawn from it is not a secret at all — it is a number an attacker can guess.
 */
export function newBotToken(): string {
  return BOT_TOKEN_PREFIX + crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

/**
 * The value stored in vx_bot_tokens.token_hash.
 *
 * Hex rather than raw bytes so the column is readable text and a bug report can say which hash
 * a row holds without a binary dump. Length is fixed at 64 characters.
 */
export function hashBotToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether a presented token hashes to the stored hash.
 *
 * timingSafeEqual, not ===. A byte-by-byte comparison that stops at the first difference takes
 * measurably longer the more correct leading characters it sees, which turns "is this the right
 * token" into a question answerable one character at a time. timingSafeEqual always reads both
 * operands in full, so every wrong guess costs the same.
 *
 * The length check runs first because timingSafeEqual throws on unequal lengths — and it leaks
 * nothing, since a hash is always 64 characters, so a length that is not 64 is not a partial
 * match but simply not a hash.
 *
 * Two details that are easy to get wrong and are handled here:
 *
 *  - The presented token is hashed *inside* this function. There is no overload that takes a
 *    hash, so a caller cannot accidentally compare two raw tokens, or a raw token against a
 *    hash and believe the answer.
 *  - Both sides are converted to buffers through the same path, so a mismatch in encoding
 *    cannot make two equal values compare unequal (or the reverse).
 */
export function botTokenMatches(presented: unknown, storedHash: unknown): boolean {
  if (typeof presented !== 'string' || typeof storedHash !== 'string') return false;
  const a = Buffer.from(hashBotToken(presented), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Whether a string could be a Varnox bot token, checked without touching the database.
 *
 * Used to reject obvious rubbish before a query is issued. It is a shape test and NOT a
 * credential check: passing it means "worth looking up", never "valid". Nothing is authorised
 * on the strength of this function.
 */
export function looksLikeBotToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== BOT_TOKEN_PREFIX.length + SECRET_CHARS) {
    return false;
  }
  return new RegExp(`^${BOT_TOKEN_PREFIX}[A-Za-z0-9_-]{${SECRET_CHARS}}$`).test(value);
}

/* ── redaction ─────────────────────────────────────────────────────────────── */

/**
 * Replace every occurrence of the given secrets in a string, for anything on its way to a log or
 * back to a caller.
 *
 * This exists because of how easy it is to leak a token by accident: a fetch failure message
 * often quotes the URL it failed on, and the Telegram URL has the bot token in its path. Logging
 * `err.message` there — an entirely reasonable-looking line — writes a live credential into the
 * server log, and returning it hands the credential to the caller. Passing the text through here
 * first removes that whole class of mistake from the code.
 *
 * Longest secret first, so a token that contains another as a prefix cannot leave a fragment
 * behind. Empty values are skipped: replacing '' would insert the marker between every
 * character.
 */
export function redact(text: string, secrets: Array<string | null | undefined>): string {
  const ordered = secrets
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of ordered) out = out.split(secret).join('[redacted]');
  return out;
}

/* ── the Telegram bot token ────────────────────────────────────────────────── */

/**
 * The shape Telegram issues: a numeric bot id, a colon, then a long opaque string.
 *
 * The id is what lets a mistyped token be rejected before a network call is spent on it, and
 * the length floor is well below what Telegram actually issues so a format change narrows
 * nothing here. This is a shape test like looksLikeBotToken above: it says a token is worth
 * asking Telegram about, not that it is real. Only getMe can say that.
 */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;

export function looksLikeTelegramToken(value: unknown): value is string {
  return typeof value === 'string' && TELEGRAM_BOT_TOKEN_PATTERN.test(value);
}
