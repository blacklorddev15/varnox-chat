import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q } from '../lib/pg';
import { ensureSchema } from '../lib/migrate';
import { saveUser } from '../lib/db';
import { createBot, revokeBotToken } from '../lib/bots';
import { hashBotToken } from '../lib/bots-token';
import { BOT_AUTH_REFUSAL, authenticateRequest } from '../lib/bot-auth';

/**
 * The bearer-token guard in front of /api/v1.
 *
 * The interesting property here is not "a good token works" — it is that every way of failing
 * produces the *same* refusal. A caller that can tell "no such token" from "revoked token" from
 * "that bot is switched off" can probe the system for facts it was not given: whether a token ever
 * existed, whether it was withdrawn, whether an account is still there. So most of what follows is
 * the same assertion made six times over, deliberately.
 *
 * Real PostgreSQL, because the guard's whole job is a database lookup.
 */

process.env.TELEGRAM_TOKEN_KEY = process.env.TELEGRAM_TOKEN_KEY || 'bot-auth-test-key';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const run = Math.random().toString(36).slice(2, 10);
const ownerId = `usr_auth_a_${run}`;

let seq = 0;
function nextHandle(): string {
  seq += 1;
  return `auth${run}${seq}`;
}

/** A Request carrying whatever Authorization header the test wants, or none. */
function requestWith(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set('authorization', header);
  return new Request('http://localhost/api/v1/me', { headers });
}

/** The body of a refusal, for asserting it says nothing it should not. */
async function refusalBody(response: Response): Promise<string> {
  return JSON.stringify(await response.json());
}

describe.skipIf(!hasDatabase)('the bot token guard', () => {
  beforeAll(async () => {
    await ensureSchema();
    await saveUser({
      id: ownerId,
      username: `authtest_${run}`,
      phone: null,
      email: null,
      displayName: `authtest_${run}`,
      about: '',
      avatar: null,
      pwHash: 'otp$disabled',
      createdAt: Date.now(),
      lastSeen: Date.now(),
    });
  });

  afterAll(async () => {
    if (hasDatabase) {
      const ids = [ownerId];
      await q('delete from vx_bot_tokens where user_id = any($1)', [ids]);
      await q('delete from vx_bots where user_id = any($1)', [ids]);
      await q('delete from vx_otp_rate where bucket like $1', [`bots:api:%`]);
      await q('delete from vx_users where id = any($1)', [ids]);
      await pool().end();
    }
  });

  describe('accepting a good token', () => {
    it('authenticates and yields the owner the token acts for', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Guard check', handle: nextHandle(), description: '', active: true,
      });

      const auth = await authenticateRequest(requestWith(`Bearer ${token}`));

      expect(auth.ok).toBe(true);
      if (!auth.ok) throw new Error('unreachable');
      expect(auth.bot.id).toBe(bot.id);
      // The capability that matters: the routes behind this scope every query by this id.
      expect(auth.ownerId).toBe(ownerId);
    });

    it('accepts a lowercase scheme, which the header spec allows', async () => {
      const { token } = await createBot(ownerId, {
        name: 'Case', handle: nextHandle(), description: '', active: true,
      });
      const auth = await authenticateRequest(requestWith(`bearer ${token}`));
      expect(auth.ok).toBe(true);
    });
  });

  describe('refusing, identically', () => {
    /** Every refusal must be this exact 401, body and all. */
    async function expectRefusal(response: Response, presented?: string) {
      expect(response.status).toBe(401);
      const body = await refusalBody(response);
      expect(JSON.parse(body).error).toBe(BOT_AUTH_REFUSAL);
      // A refusal that echoed the credential would write it into the caller's logs on every typo.
      if (presented) expect(body).not.toContain(presented);
      return body;
    }

    it('refuses a request with no Authorization header at all', async () => {
      const auth = await authenticateRequest(requestWith(null));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response);
    });

    it('refuses a header that is not a bearer scheme', async () => {
      const { token } = await createBot(ownerId, {
        name: 'Scheme', handle: nextHandle(), description: '', active: true,
      });
      const auth = await authenticateRequest(requestWith(token));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response, token);
    });

    it('refuses a bearer value that is not token-shaped', async () => {
      for (const value of ['', 'nonsense', 'vx_short', 'vx_' + 'a'.repeat(50)]) {
        const auth = await authenticateRequest(requestWith(`Bearer ${value}`));
        expect(auth.ok, value).toBe(false);
        if (auth.ok) throw new Error('unreachable');
        await expectRefusal(auth.response, value);
      }
    });

    it('refuses a well-formed token that was never issued', async () => {
      const ghost = 'vx_' + 'A'.repeat(43);
      const auth = await authenticateRequest(requestWith(`Bearer ${ghost}`));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response, ghost);
    });

    it('refuses the stored hash presented as a token', async () => {
      // The hash is what is in the database, so this is the one an attacker who has read the table
      // would try. It must not authenticate.
      const { token } = await createBot(ownerId, {
        name: 'Hash attempt', handle: nextHandle(), description: '', active: true,
      });
      const hash = hashBotToken(token);
      const auth = await authenticateRequest(requestWith(`Bearer ${hash}`));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response, hash);
    });

    it('refuses a revoked token', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Revoked', handle: nextHandle(), description: '', active: true,
      });
      // Good before...
      expect((await authenticateRequest(requestWith(`Bearer ${token}`))).ok).toBe(true);
      await revokeBotToken(ownerId, bot.id);
      // ...and refused after, indistinguishable from a token that never existed.
      const auth = await authenticateRequest(requestWith(`Bearer ${token}`));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response, token);
    });

    it('refuses a token whose bot the owner switched off', async () => {
      const { token } = await createBot(ownerId, {
        name: 'Inactive', handle: nextHandle(), description: '', active: false,
      });
      const auth = await authenticateRequest(requestWith(`Bearer ${token}`));
      expect(auth.ok).toBe(false);
      if (auth.ok) throw new Error('unreachable');
      await expectRefusal(auth.response, token);
    });

    it('cannot be told apart from a valid one by status or wording', async () => {
      // Collate the refusals from every branch above and assert they are one answer.
      const { token: live } = await createBot(ownerId, {
        name: 'Live', handle: nextHandle(), description: '', active: true,
      });
      const { bot: toRevoke, token: revoked } = await createBot(ownerId, {
        name: 'Then revoked', handle: nextHandle(), description: '', active: true,
      });
      await revokeBotToken(ownerId, toRevoke.id);

      const cases: Array<string | null> = [
        null,
        `Bearer vx_${'B'.repeat(43)}`,
        `Bearer ${revoked}`,
      ];
      const seen: string[] = [];
      for (const header of cases) {
        const auth = await authenticateRequest(requestWith(header));
        expect(auth.ok).toBe(false);
        if (auth.ok) throw new Error('unreachable');
        seen.push(`${auth.response.status} ${await refusalBody(auth.response)}`);
      }
      expect(new Set(seen).size).toBe(1);
      // And the live token is not among the refusals.
      expect((await authenticateRequest(requestWith(`Bearer ${live}`))).ok).toBe(true);
    });
  });

  describe('metering', () => {
    it('meters per bot, and answers 429 rather than 401 when it is spent', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Metered', handle: nextHandle(), description: '', active: true,
      });

      // The bucket is per bot id, and other tests in this file have their own bots, so this one
      // starts empty. 120 is the configured ceiling.
      let allowed = 0;
      let limited: Response | null = null;
      for (let i = 0; i < 125; i++) {
        const auth = await authenticateRequest(requestWith(`Bearer ${token}`));
        if (auth.ok) allowed += 1;
        else {
          limited = auth.response;
          break;
        }
      }

      expect(allowed).toBe(120);
      expect(limited).not.toBeNull();
      // 429, not 401: the credential is fine and the caller should retry, which is different
      // advice from "your token is wrong".
      expect(limited!.status).toBe(429);
      expect(JSON.stringify(await limited!.json())).not.toContain(token);

      // A different bot is unaffected, which is what "per bot" has to mean to be worth anything.
      const other = await createBot(ownerId, {
        name: 'Unaffected', handle: nextHandle(), description: '', active: true,
      });
      expect((await authenticateRequest(requestWith(`Bearer ${other.token}`))).ok).toBe(true);
      void bot;
    });
  });
});
