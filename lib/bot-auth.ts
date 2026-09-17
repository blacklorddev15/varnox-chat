import { bad } from './api';
import { authenticateBot, botRateMessage, botRateSlot } from './bots';
import { looksLikeBotToken } from './bots-token';
import type { Bot } from './types';

/**
 * Authentication for the machine-facing API, where the credential is a bot token rather than a
 * cookie.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Every other route in this app authenticates with a session cookie, which is a credential for a
 * browser: it cannot be scoped, it cannot be revoked without ending the session everywhere, and
 * anyone an integration shares it with is indistinguishable from the account holder. An
 * integration needs something else — a credential that names a program, that the account can
 * withdraw on its own, and that stops working the moment it is withdrawn. That is what the token
 * minted on the Bots screen is, and this is the code that accepts it.
 *
 * WHAT A TOKEN IS WORTH, STATED PLAINLY
 *
 * A valid token is the account. The routes behind this guard act as the token's owner, which
 * means anything they expose is exposed to whoever holds the token. That is not a flaw to be
 * engineered around — it is what "a bot acting for its owner" has to mean — but it is the reason
 * the surface behind it is built one endpoint at a time rather than by mirroring the whole app.
 * A token is not a lesser account; it is the same account with a better lock.
 *
 * THE THREE REFUSALS, AND WHY THEY LOOK IDENTICAL
 *
 * Missing header, malformed token, revoked token, token for a bot that was switched off, token
 * for an account that does not exist — every one of them is the same 401 with the same sentence.
 *
 * A caller learning which of those it was learns something it should not: whether a token ever
 * existed, whether it was revoked, or whether an account is still there. The legitimate holder of
 * a token has no use for that distinction either — every one of these means "stop and check your
 * credential", and the place to check it is the Bots screen, which says plainly whether a token
 * is live or revoked. So the information exists, it just is not served over the API.
 *
 * The body also never repeats the presented value. A refusal that echoed the token back would put
 * a credential into the caller's logs — and into whatever aggregates those logs — on every typo.
 */

export type BotAuth =
  | { ok: true; bot: Bot; ownerId: string }
  | { ok: false; response: Response };

/**
 * The one sentence every refusal uses.
 *
 * A shared constant for two reasons: the refusals cannot drift apart into a set that leaks by
 * difference — one wording for a missing header and another for a revoked token would rebuild the
 * oracle this file goes to some trouble to avoid — and a test can assert on it by name rather than
 * on a string copied into two places.
 */
export const BOT_AUTH_REFUSAL =
  'A valid bot token is required. Send it as: Authorization: Bearer vx_…';

/** Pull the token out of an Authorization header, or null. */
function bearer(header: string | null): string | null {
  if (!header) return null;
  /**
   * The scheme is matched case-insensitively, because RFC 7235 says it is case-insensitive and
   * clients do send `bearer`. The token itself is returned untouched: folding its case would
   * change the value, and the alphabet is case-significant.
   *
   * The token is *not* trimmed of internal whitespace — only the leading and trailing space the
   * header format allows. A token with a space in the middle is not a token.
   */
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Authenticate a request, or produce the refusal to return.
 *
 * Returns a Response rather than throwing, so a route cannot forget to handle the failure: there
 * is no way to get at `auth.bot` without first narrowing on `auth.ok`, and the compiler enforces
 * it. Throwing would also work, but it would mean this module decided an HTTP status, which is
 * the route's business.
 *
 * The shape test runs before the database lookup on purpose. It is a cheap rejection of the
 * overwhelmingly common case — a header with no token in it, or a session cookie pasted where a
 * token belongs — and it means a request that was never going to authenticate does not become a
 * query. It authorises nothing: passing it means "worth looking up".
 */
export async function authenticateRequest(req: Request): Promise<BotAuth> {
  const presented = bearer(req.headers.get('authorization'));
  if (!presented || !looksLikeBotToken(presented)) {
    return { ok: false, response: bad(BOT_AUTH_REFUSAL, 401) };
  }

  const found = await authenticateBot(presented);
  if (!found) return { ok: false, response: bad(BOT_AUTH_REFUSAL, 401) };

  /**
   * Metered by bot id, after the token has been proved — not by the presented string, which would
   * let anyone fill an unlimited number of buckets with tokens that do not exist, and not before
   * verification, which would let a bad token spend a good bot's allowance.
   *
   * 429 rather than 401 for the limit itself: the credential is fine and the caller should retry
   * later, which is a different instruction from "your token is wrong".
   */
  const slot = await botRateSlot(found.bot.id, 'api');
  if (!slot.allowed) {
    return { ok: false, response: bad(botRateMessage('api', slot.retryAfterMs), 429) };
  }

  return { ok: true, bot: found.bot, ownerId: found.ownerId };
}
