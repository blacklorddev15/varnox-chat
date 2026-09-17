import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { telegramGetMe } from '../lib/telegram';

/**
 * A live call to Telegram, opt-in.
 *
 * Every other test in this suite stubs fetch, which is right for testing what this code does with
 * each kind of answer — but it cannot tell you whether the answer arriving from the real API is the
 * one that was assumed. That gap is worth closing at least once against the actual service, so this
 * file makes one real request.
 *
 * It is skipped unless LIVE_TELEGRAM=1, so `npm test` never touches the network and never fails
 * because a build machine has no outbound access or Telegram is briefly unhappy:
 *
 *   LIVE_TELEGRAM=1 npx vitest run tests/live-telegram.test.ts
 *
 * It uses a token that is well-formed and does not exist. That is deliberate: the point is to see
 * the real rejection path, and a test that needed a working bot token could not be committed. It
 * also means the only thing this request can do to anybody's account is nothing.
 */

const live = process.env.LIVE_TELEGRAM === '1';

/** Correct shape, no such bot. Telegram answers 401 for this. */
const NONEXISTENT = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

const SAVED = process.env.TELEGRAM_BOT_API_URL;

beforeEach(() => {
  process.env.TELEGRAM_BOT_API_URL = 'https://api.telegram.org';
});

afterEach(() => {
  if (SAVED === undefined) delete process.env.TELEGRAM_BOT_API_URL;
  else process.env.TELEGRAM_BOT_API_URL = SAVED;
});

describe.skipIf(!live)('Telegram, for real', () => {
  it('reaches api.telegram.org and reports a rejection the way the route expects', async () => {
    const outcome = await telegramGetMe(NONEXISTENT);

    // The whole point of the check: the live service answers the way the stubbed tests assume.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');

    // Telegram returns 401, which lib/telegram.ts maps to 400 — the status the test route turns
    // into "Telegram rejected that bot token. Check it against the bot it was issued for."
    expect(outcome.status).toBe(400);
    expect(outcome.error).toMatch(/rejected/i);

    // And the credential that was put in the URL path does not come back out.
    expect(JSON.stringify(outcome)).not.toContain(NONEXISTENT);
  }, 20_000);

  it('builds the URL path Telegram actually serves', async () => {
    // A wrong path would 404, which lib/telegram.ts reports as a 502 about the address rather than
    // a 400 about the token. Asserting the token-shaped outcome is therefore an assertion that the
    // path was right — the failure would be a completely different message.
    const outcome = await telegramGetMe(NONEXISTENT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error).not.toMatch(/TELEGRAM_BOT_API_URL|did not offer getMe/);
  }, 20_000);
});
