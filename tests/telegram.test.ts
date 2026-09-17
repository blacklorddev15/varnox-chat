import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { telegramConfig, telegramGetMe, telegramSetupMessage } from '../lib/telegram';

/**
 * The Telegram getMe test.
 *
 * Two things are being proved here, and the second one matters more than the first.
 *
 *  1. Each outcome is reported as itself — a missing variable, a rejected token, an unreachable
 *     server and a 404 are different instructions to whoever has to fix it, so they must not
 *     collapse into "the test failed".
 *  2. The token never leaves this module. Telegram puts the bot token in the request *path*, so
 *     the URL is a credential, and anything that quotes the URL leaks it. Fetch failures do
 *     exactly that. Every test below that produces an error asserts the token is absent from it.
 *
 * The network is stubbed through the injectable fetch parameter rather than by patching a global,
 * so a test cannot accidentally reach the real Telegram and no other test can be affected by the
 * stubbing.
 */

const BASE = 'https://bot-api.internal:8081/';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

const SAVED_URL = process.env.TELEGRAM_BOT_API_URL;

beforeEach(() => {
  process.env.TELEGRAM_BOT_API_URL = BASE;
});

afterEach(() => {
  if (SAVED_URL === undefined) delete process.env.TELEGRAM_BOT_API_URL;
  else process.env.TELEGRAM_BOT_API_URL = SAVED_URL;
});

/** A fetch that records the URL it was asked for and answers with whatever is supplied. */
function stubFetch(response: Response | Error) {
  const calls: string[] = [];
  const impl = async (input: string) => {
    calls.push(input);
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('telegramConfig', () => {
  it('reports a missing variable as missing, not as invalid', () => {
    delete process.env.TELEGRAM_BOT_API_URL;
    expect(telegramConfig()).toEqual({ ok: false, reason: 'missing' });
  });

  it('treats an empty or whitespace value as missing', () => {
    process.env.TELEGRAM_BOT_API_URL = '   ';
    expect(telegramConfig()).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports an unparseable value as invalid', () => {
    process.env.TELEGRAM_BOT_API_URL = 'not a url';
    expect(telegramConfig()).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a scheme fetch cannot be trusted with', () => {
    process.env.TELEGRAM_BOT_API_URL = 'ftp://bot.internal';
    expect(telegramConfig()).toEqual({ ok: false, reason: 'invalid' });
  });

  it('strips trailing slashes so the request path has one slash and not two', () => {
    process.env.TELEGRAM_BOT_API_URL = 'https://bot.internal:8081///';
    const config = telegramConfig();
    expect(config).toEqual({ ok: true, base: 'https://bot.internal:8081' });
  });

  it('names the variable in the setup message, and never a value', () => {
    for (const reason of ['missing', 'invalid'] as const) {
      const message = telegramSetupMessage(reason);
      expect(message).toContain('TELEGRAM_BOT_API_URL');
      expect(message).not.toContain(BASE);
    }
  });
});

describe('telegramGetMe', () => {
  it('calls getMe on the configured server and reports the bot', async () => {
    const { impl, calls } = stubFetch(
      json({ ok: true, result: { id: 987654321, is_bot: true, first_name: 'Varnox', username: 'varnox_bot' } })
    );

    const outcome = await telegramGetMe(TOKEN, impl);

    expect(outcome).toEqual({
      ok: true,
      bot: { id: '987654321', username: 'varnox_bot', firstName: 'Varnox' },
    });
    // The one place the token is meant to appear: Telegram's own URL format.
    expect(calls).toEqual([`${BASE.replace(/\/$/, '')}/bot${TOKEN}/getMe`]);
  });

  it('survives a bot with no username', async () => {
    const { impl } = stubFetch(json({ ok: true, result: { id: 1, first_name: 'Nameless' } }));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome).toEqual({ ok: true, bot: { id: '1', username: '', firstName: 'Nameless' } });
  });

  it('answers 503 with the setup message when the variable is unset', async () => {
    delete process.env.TELEGRAM_BOT_API_URL;
    const { impl, calls } = stubFetch(json({ ok: true, result: { id: 1 } }));

    const outcome = await telegramGetMe(TOKEN, impl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(503);
    expect(outcome.error).toContain('TELEGRAM_BOT_API_URL');
    // Nothing was sent anywhere: a missing variable must not fall back to a public address.
    expect(calls).toEqual([]);
  });

  it('answers 400 and does not blame the server when Telegram rejects the token', async () => {
    const { impl } = stubFetch(json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(400);
    expect(outcome.error).toMatch(/rejected/i);
    expect(outcome.error).not.toContain(TOKEN);
  });

  it('answers 502 and points at the address when getMe is not there', async () => {
    const { impl } = stubFetch(json({ ok: false, description: 'Not Found' }, 404));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(502);
    expect(outcome.error).toContain('TELEGRAM_BOT_API_URL');
  });

  it('handles a 200 carrying ok:false, which is how Telegram reports most problems', async () => {
    const { impl } = stubFetch(
      json({ ok: false, error_code: 401, description: 'Unauthorized' })
    );
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(400);
    expect(outcome.error).toBe('Unauthorized');
  });

  it('discards a fetch failure rather than quoting the URL it failed on', async () => {
    /**
     * The single most likely way to leak the token: `catch (e) { return e.message }`. Node's
     * fetch error for a refused connection reads "fetch failed", but a timeout, a TLS error or a
     * proxy error all quote the URL — and the URL contains the token. The module throws away the
     * cause for exactly this reason, and this test is what stops that being undone.
     */
    const { impl } = stubFetch(new Error(`request to ${BASE}bot${TOKEN}/getMe failed`));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(502);
    expect(outcome.error).not.toContain(TOKEN);
    expect(outcome.error).not.toContain(BASE);
    expect(outcome.error).toContain('Could not reach');
  });

  it('redacts the token out of an upstream description that echoes it', async () => {
    // A reverse proxy in front of a self-hosted bot API server will happily quote the path it
    // refused. The response body is treated as hostile for this reason.
    const { impl } = stubFetch(
      json({ ok: false, description: `no route for /bot${TOKEN}/getMe` }, 500)
    );
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error).not.toContain(TOKEN);
    expect(outcome.error).toContain('[redacted]');
  });

  it('also redacts when the echoing body arrives with a 200', async () => {
    const { impl } = stubFetch(json({ ok: false, description: `bad path /bot${TOKEN}/getMe` }));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error).not.toContain(TOKEN);
  });

  it('answers 502 rather than pretending when the reply is not JSON', async () => {
    const { impl } = stubFetch(new Response('<html>502 Bad Gateway</html>', { status: 200 }));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(502);
    expect(outcome.error).not.toContain(TOKEN);
  });

  it('answers 502 when a 200 carries no bot', async () => {
    const { impl } = stubFetch(json({ ok: true, result: {} }));
    const outcome = await telegramGetMe(TOKEN, impl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(502);
  });

  it('never returns the token, on any path', async () => {
    const responses: Array<Response | Error> = [
      json({ ok: true, result: { id: 5, username: 'x' } }),
      json({ ok: false, description: `see /bot${TOKEN}/getMe` }, 401),
      json({ ok: false, description: `see /bot${TOKEN}/getMe` }, 500),
      json({ ok: false, description: 'Unauthorized' }),
      json({ ok: true, result: {} }),
      new Error(`failed: /bot${TOKEN}/getMe`),
      new Response('not json', { status: 200 }),
    ];
    for (const response of responses) {
      const { impl } = stubFetch(response);
      const outcome = await telegramGetMe(TOKEN, impl);
      expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    }
  });
});
