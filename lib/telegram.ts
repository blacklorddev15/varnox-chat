import { redact } from './bots-token';

/**
 * The Telegram Bot API server, and the one call Varnox makes to it.
 *
 * ARCHITECTURE, because it decides what this file may contain
 *
 * The bot API server is a separate, self-hosted process — the C++ server from telegram-bot-api —
 * and it is not part of this Next.js application. None of its source lives here and it is not
 * deployed by this repository. Varnox reaches it over HTTP, and only from the server: the
 * address is read from TELEGRAM_BOT_API_URL and never sent to the browser.
 *
 * That address is configuration, not a constant. A hardcoded URL would be wrong for anyone
 * self-hosting this, and would quietly point a fork at somebody else's server. When the variable
 * is missing this module refuses to guess — it reports a setup error, which is a five-second fix,
 * rather than a connection error to a host the operator never chose, which is not.
 *
 * WHY EVERY REQUEST URL IS TREATED AS A SECRET
 *
 * Telegram's Bot API puts the token in the path: /bot<TOKEN>/getMe. There is no header form. So
 * the token is part of the URL, which means any code that echoes a URL — a fetch failure message,
 * a Next.js error page, an exception logged at the call site — is echoing a live credential. The
 * rules that follow from that are applied without exception here:
 *
 *   - the constructed URL is never returned to a caller
 *   - every string that leaves this module passes through redact() with the token
 *   - the base URL is not returned either, since the requirement is that a private API address
 *     does not reach client code, and an error message is client code's input
 *
 * The result is that this file can be called with a secret and cannot leak it, which is a
 * property worth being able to state rather than hope for. tests/telegram.test.ts asserts it.
 */

/** How long to wait on the bot API server before giving up. */
const TIMEOUT_MS = 8_000;

export type TelegramConfig =
  | { ok: true; base: string }
  | { ok: false; reason: 'missing' | 'invalid' };

/**
 * Read and check TELEGRAM_BOT_API_URL.
 *
 * Only http and https are accepted. A URL of any other scheme is not something fetch can be
 * trusted to handle consistently, and validating it here means a misconfiguration is reported as
 * one instead of surfacing as a confusing network error later.
 *
 * The trailing slash is trimmed so joining `/bot<token>/getMe` produces one slash, not two.
 * Telegram's own servers tolerate the doubled slash; a reverse proxy in front of a self-hosted
 * one may not, and a 404 caused by `//` is a genuinely annoying thing to debug.
 */
export function telegramConfig(): TelegramConfig {
  const raw = (process.env.TELEGRAM_BOT_API_URL || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'invalid' };
  return { ok: true, base: url.toString().replace(/\/+$/, '') };
}

/**
 * The two setup errors, worded for the person who has to fix them.
 *
 * Shown in the UI as well as returned by the API, so they say what to set and where — an
 * operator reading "Telegram is not configured" learns nothing, while one reading the variable
 * name can act. Neither message quotes the variable's value: an invalid URL may still be a
 * credential-bearing one.
 */
export function telegramSetupMessage(reason: 'missing' | 'invalid'): string {
  return reason === 'missing'
    ? 'TELEGRAM_BOT_API_URL is not set on the server, so Varnox cannot reach a Telegram Bot API server. Set it and redeploy, then try the test again.'
    : 'TELEGRAM_BOT_API_URL is not a valid http or https URL. Correct it and redeploy, then try the test again.';
}

/** What getMe says about a bot. Only what the UI shows is kept. */
export type TelegramBotInfo = {
  id: string;
  username: string;
  firstName: string;
};

export type GetMeOutcome =
  | { ok: true; bot: TelegramBotInfo }
  | { ok: false; status: number; error: string };

/** Fetch, injectable so a test can drive this without a network. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Pull the human-readable reason out of a Telegram error body, if there is one.
 *
 * Redacted before it is returned. Telegram's own descriptions do not repeat the token, but the
 * body of a failed request is exactly the sort of place one ends up — a proxy in front of a
 * self-hosted server, for instance, will happily echo the path it refused. Treating the response
 * as hostile costs one line and removes the possibility.
 */
function upstreamReason(body: unknown, token: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const description = (body as { description?: unknown }).description;
  if (typeof description !== 'string' || !description.trim()) return null;
  return redact(description.trim().slice(0, 300), [token]);
}

/**
 * Call getMe on the bot API server.
 *
 * getMe is the only method used: it is the one that answers "is this token real, and which bot
 * is it" without changing anything. Nothing here sends a message, sets a webhook or moves a bot
 * between servers, so a test action cannot have a side effect an operator did not intend.
 *
 * The failure branches each carry a distinct message because they need distinct actions: a
 * missing variable is a redeploy, a rejected token is a re-paste, an unreachable server is a
 * look at the bot API process, and a 404 points at the address rather than the token. Collapsing
 * them into "test failed" would throw that away.
 */
export async function telegramGetMe(
  token: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<GetMeOutcome> {
  const config = telegramConfig();
  if (!config.ok) return { ok: false, status: 503, error: telegramSetupMessage(config.reason) };

  // The one place the token is ever put into a string. Held in a local so it cannot be reached
  // from any other branch.
  const endpoint = `${config.base}/bot${token}/getMe`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // The caught error is deliberately not read. Its message would name the URL, and the URL
    // names the token — so the one useful line here is the one that must not be logged.
    // There is also nothing to add: a timeout and a refused connection are the same instruction
    // to the operator, which is to check that the bot API server is running.
    return {
      ok: false,
      status: 502,
      error:
        'Could not reach the Telegram Bot API server. Check that it is running and that TELEGRAM_BOT_API_URL points at it.',
    };
  }

  let body: unknown = null;
  let parsed = true;
  try {
    body = await response.json();
  } catch {
    body = null;
    parsed = false;
  }

  if (!response.ok) {
    const reason = upstreamReason(body, token);
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 400,
        error: 'Telegram rejected that bot token. Check it against the bot it was issued for.',
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        status: 502,
        error:
          'The server at TELEGRAM_BOT_API_URL did not offer getMe. That usually means the address points at something other than a Telegram Bot API server.',
      };
    }
    return {
      ok: false,
      status: 502,
      error: reason ?? `The Telegram Bot API server answered ${response.status}.`,
    };
  }

  /**
   * A body that is not JSON at all, with a healthy status code.
   *
   * That combination does not come from the Bot API — it comes from whatever is actually
   * listening at the configured address, most often a proxy's error page or a web server's
   * default index. Reported as a server problem rather than a rejected token, because the token
   * was never examined and telling the operator to check their token would send them to the wrong
   * place entirely.
   */
  if (!parsed) {
    return {
      ok: false,
      status: 502,
      error:
        'The server at TELEGRAM_BOT_API_URL answered with something that is not JSON, so it may not be a Telegram Bot API server.',
    };
  }

  // A 200 carrying ok:false. Telegram reports most method-level problems this way rather than
  // through the status code, so this branch is the normal failure path, not an edge case.
  if (!body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) {
    return {
      ok: false,
      status: 400,
      error: upstreamReason(body, token) ?? 'The Telegram Bot API server refused getMe for this token.',
    };
  }

  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      status: 502,
      error: 'The Telegram Bot API server answered getMe without describing a bot.',
    };
  }

  const raw = result as { id?: unknown; username?: unknown; first_name?: unknown };
  const id = raw.id === undefined || raw.id === null ? '' : String(raw.id);
  if (!id) {
    return {
      ok: false,
      status: 502,
      error: 'The Telegram Bot API server answered getMe without a bot id.',
    };
  }

  return {
    ok: true,
    bot: {
      id,
      username: typeof raw.username === 'string' ? raw.username : '',
      firstName: typeof raw.first_name === 'string' ? raw.first_name : '',
    },
  };
}
