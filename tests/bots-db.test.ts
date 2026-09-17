import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q } from '../lib/pg';
import { ensureSchema } from '../lib/migrate';
import { saveUser } from '../lib/db';
import {
  botForToken,
  botTelegramToken,
  createBot,
  deleteBot,
  getBot,
  handleTaken,
  listBots,
  recordTelegramCheck,
  revokeBotToken,
} from '../lib/bots';
import { hashBotToken } from '../lib/bots-token';

/**
 * The bot data layer, against a real PostgreSQL.
 *
 * This suite is the one that proves the two claims the design rests on, and neither can be
 * checked without a database:
 *
 *  - Authorization is a property of the query. Two real accounts exist, one creates bots, and
 *    the other must not be able to see, revoke, delete or authenticate with them. Filtering by
 *    owner inside each statement is what makes that true, so it is asserted end to end rather
 *    than by inspecting the SQL.
 *  - The secrets are not in the rows. The plaintext Varnox token and the plaintext Telegram
 *    token are both checked against what the table actually holds, by reading the table.
 *
 * Skipped when DATABASE_URL is not set, so `npm test` still works on a machine with no database.
 * When it is set, the schema is reconciled first, so pointing it at an empty database is enough.
 */

/**
 * Key material for the sealed column.
 *
 * Set at module scope, before any test body runs, because this suite writes a Telegram token and
 * sealSecret() refuses without a key. A literal is right here for the same reason the other tests
 * use one: the point is the round trip, not the secrecy of the fixture.
 */
process.env.TELEGRAM_TOKEN_KEY = process.env.TELEGRAM_TOKEN_KEY || 'bots-db-test-key';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const run = Math.random().toString(36).slice(2, 10);

const ownerId = `usr_test_a_${run}`;
const otherId = `usr_test_b_${run}`;

const TELEGRAM_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

/**
 * A fresh handle for each bot a test creates.
 *
 * Handles are unique across the whole table rather than per account, so two tests cannot share one
 * — and a literal would make the second test to run fail for a reason that has nothing to do with
 * what it is checking. The run suffix keeps concurrent suites and leftovers from earlier runs out
 * of each other's way.
 */
let handleSeq = 0;
function nextHandle(prefix = 'h'): string {
  handleSeq += 1;
  return `${prefix}${run}${handleSeq}`;
}

async function makeAccount(id: string, username: string) {
  await saveUser({
    id,
    username,
    phone: null,
    email: null,
    displayName: username,
    about: '',
    avatar: null,
    pwHash: 'otp$disabled',
    createdAt: Date.now(),
    lastSeen: Date.now(),
  });
}

describe.skipIf(!hasDatabase)('bots data layer', () => {
  beforeAll(async () => {
    // Bring the database up to date rather than assuming `npm run db:apply` was run — the whole
    // point of ensureSchema() is that a fresh database needs no manual step, and that is worth
    // exercising here too.
    await ensureSchema();
    await makeAccount(ownerId, `bottest_a_${run}`);
    await makeAccount(otherId, `bottest_b_${run}`);
  });

  afterAll(async () => {
    // Everything this suite wrote, and nothing else. The ids are random per run, so a run cannot
    // reach another run's rows or the app's own.
    if (hasDatabase) {
      const ids = [ownerId, otherId];
      await q('delete from vx_bot_tokens where user_id = any($1)', [ids]);
      await q('delete from vx_bots where user_id = any($1)', [ids]);
      await q('delete from vx_otp_rate where bucket like $1', [`bots:%:${ownerId}`]);
      await q('delete from vx_otp_rate where bucket like $1', [`bots:%:${otherId}`]);
      await q('delete from vx_users where id = any($1)', [ids]);
      // The pool is global to this process; without closing it the runner hangs on an open
      // socket rather than reporting a result.
      await pool().end();
    }
  });

  describe('creating a bot', () => {
    it('returns a bot and a plaintext token, exactly once', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Support bot',
        handle: nextHandle(),
        description: 'Answers questions',
        active: true,
      });

      expect(bot.name).toBe('Support bot');
      expect(bot.description).toBe('Answers questions');
      expect(bot.active).toBe(true);
      expect(bot.hasTelegram).toBe(false);
      expect(bot.tokenIssuedAt).toBeGreaterThan(0);
      expect(bot.tokenRevokedAt).toBeNull();

      expect(token).toMatch(/^vx_[A-Za-z0-9_-]{43}$/);

      // What the response looks like matters as much as what it says: there is no field here
      // that could hold a secret, so no future projection can accidentally grow one.
      expect(Object.keys(bot).sort()).toEqual(
        [
          'active',
          'createdAt',
          'description',
          'handle',
          'hasTelegram',
          'id',
          'name',
          'telegramBotId',
          'telegramCheckedAt',
          'telegramUsername',
          'tokenIssuedAt',
          'tokenRevokedAt',
          'updatedAt',
        ].sort()
      );
      expect(JSON.stringify(bot)).not.toContain(token);
    });

    it('stores only a hash of the token', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Hash check',
        handle: nextHandle(),
        description: '',
        active: true,
      });

      const rows = await q<Record<string, unknown>>('select * from vx_bot_tokens where bot_id = $1', [
        bot.id,
      ]);
      expect(rows).toHaveLength(1);

      // The row, serialised whole, must not contain the token anywhere — not in a column, not in
      // a default, not in a comment. This is a stronger assertion than checking token_hash.
      expect(JSON.stringify(rows[0])).not.toContain(token);
      expect(rows[0].token_hash).toBe(hashBotToken(token));
      expect(rows[0].revoked_at).toBeNull();
    });

    it('stores the Telegram token sealed, never in the clear', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Telegram bot',
        handle: nextHandle(),
        description: '',
        active: true,
        telegramToken: TELEGRAM_TOKEN,
      });

      const rows = await q<{ telegram_secret: string }>(
        'select telegram_secret from vx_bots where id = $1',
        [bot.id]
      );
      expect(rows[0].telegram_secret).toBeTruthy();
      expect(rows[0].telegram_secret).not.toBe(TELEGRAM_TOKEN);
      expect(rows[0].telegram_secret).not.toContain(TELEGRAM_TOKEN);

      // ...and it can still be read back by the one function that is allowed to.
      expect(await botTelegramToken(ownerId, bot.id)).toBe(TELEGRAM_TOKEN);
      expect(bot.hasTelegram).toBe(true);
    });

    it('never exposes the Telegram token through a list or a detail read', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Sealed bot',
        handle: nextHandle(),
        description: '',
        active: true,
        telegramToken: TELEGRAM_TOKEN,
      });

      const listed = await listBots(ownerId);
      const detail = await getBot(ownerId, bot.id);
      expect(JSON.stringify(listed)).not.toContain(TELEGRAM_TOKEN);
      expect(JSON.stringify(detail)).not.toContain(TELEGRAM_TOKEN);
    });
  });

  describe('handles', () => {
    it('is stored on the bot and returned', async () => {
      const handle = nextHandle('stored');
      const { bot } = await createBot(ownerId, {
        name: 'With a handle',
        handle,
        description: '',
        active: true,
      });
      expect(bot.handle).toBe(handle);
      expect((await getBot(ownerId, bot.id))?.handle).toBe(handle);
    });

    it('is unique across accounts, not just within one', async () => {
      /**
       * The property that makes a handle worth having. Scoping uniqueness to the owner would let
       * two accounts both answer to @support-bot, and the whole point is telling them apart.
       */
      const handle = nextHandle('shared');
      await createBot(ownerId, { name: 'First', handle, description: '', active: true });

      const taken = await handleTaken(handle);
      expect(taken).toBe(true);

      // The second attempt fails, and fails with the wording lib/api.ts turns into a 409.
      await expect(
        createBot(otherId, { name: 'Second', handle, description: '', active: true })
      ).rejects.toThrow(/already taken/i);
    });

    it('cannot be escaped by capitalisation', async () => {
      const handle = nextHandle('cased');
      await createBot(ownerId, { name: 'Lower', handle, description: '', active: true });

      // Uniqueness is on lower(handle) in the database, so this is caught even though the two
      // strings differ — which matters because a future caller might not fold before inserting.
      await expect(
        createBot(otherId, {
          name: 'Upper',
          handle: handle.toUpperCase(),
          description: '',
          active: true,
        })
      ).rejects.toThrow(/already taken/i);

      expect(await handleTaken(handle.toUpperCase())).toBe(true);
    });

    it('reports a free handle as free', async () => {
      expect(await handleTaken(nextHandle('free'))).toBe(false);
    });

    it('is not overwritten by a later write to the same bot', async () => {
      const handle = nextHandle('stable');
      const { bot } = await createBot(ownerId, {
        name: 'Stable',
        handle,
        description: '',
        active: true,
      });
      await recordTelegramCheck(ownerId, bot.id, { id: '1', username: 'x' });
      expect((await getBot(ownerId, bot.id))?.handle).toBe(handle);
    });
  });

  describe('authorization isolation', () => {
    let mineId = '';
    let myToken = '';

    beforeAll(async () => {
      const created = await createBot(ownerId, {
        name: 'Owner only',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      mineId = created.bot.id;
      myToken = created.token;
    });

    it('lists only the signed-in account’s bots', async () => {
      const mine = await listBots(ownerId);
      const theirs = await listBots(otherId);

      expect(mine.map((b) => b.id)).toContain(mineId);
      expect(theirs.map((b) => b.id)).not.toContain(mineId);
      expect(theirs).toHaveLength(0);
    });

    it('reads another account’s bot as absent, not as forbidden', async () => {
      expect(await getBot(ownerId, mineId)).not.toBeNull();
      // Null rather than a distinct "exists but not yours": a 403 here and a 404 there would let
      // an attacker enumerate which bot ids are real.
      expect(await getBot(otherId, mineId)).toBeNull();
    });

    it('cannot revoke another account’s token', async () => {
      expect(await revokeBotToken(otherId, mineId)).toBe(false);
      // ...and the token still works, which is the part that actually matters.
      expect(await botForToken(myToken)).not.toBeNull();
      expect((await getBot(ownerId, mineId))?.tokenRevokedAt).toBeNull();
    });

    it('cannot delete another account’s bot or its tokens', async () => {
      expect(await deleteBot(otherId, mineId)).toBe(false);
      expect(await getBot(ownerId, mineId)).not.toBeNull();

      const tokens = await q('select id from vx_bot_tokens where bot_id = $1', [mineId]);
      expect(tokens).toHaveLength(1);
    });

    it('cannot read another account’s Telegram token', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Not yours',
        handle: nextHandle(),
        description: '',
        active: true,
        telegramToken: TELEGRAM_TOKEN,
      });
      expect(await botTelegramToken(otherId, bot.id)).toBeNull();
      expect(await botTelegramToken(ownerId, bot.id)).toBe(TELEGRAM_TOKEN);
    });

    it('does not leak another account’s bots through a search-shaped read', async () => {
      // listBots takes no query term today, but the bounding limit is the other way a read can
      // over-reach: a limit applied before the owner filter would return other people's rows.
      const theirs = await listBots(otherId, 1000);
      expect(theirs).toHaveLength(0);
    });
  });

  describe('token verification and revocation', () => {
    it('authenticates a live token to its bot', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Verifiable',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      const found = await botForToken(token);
      expect(found?.id).toBe(bot.id);
    });

    it('refuses a token that was never issued', async () => {
      expect(await botForToken('vx_' + 'a'.repeat(43))).toBeNull();
      expect(await botForToken('')).toBeNull();
      expect(await botForToken('not-a-token')).toBeNull();
    });

    it('refuses the stored hash presented as a token', async () => {
      const { token } = await createBot(ownerId, {
        name: 'Hash is not a token',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      expect(await botForToken(hashBotToken(token))).toBeNull();
    });

    it('stops authenticating the moment the token is revoked', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Revocable',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      expect(await botForToken(token)).not.toBeNull();

      expect(await revokeBotToken(ownerId, bot.id)).toBe(true);
      expect(await botForToken(token)).toBeNull();

      // The row survives as the record that the token existed. A revoked credential that leaves
      // no trace is indistinguishable from one that was never issued.
      const rows = await q<{ revoked_at: number | null }>(
        'select revoked_at from vx_bot_tokens where bot_id = $1',
        [bot.id]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].revoked_at)).toBeGreaterThan(0);

      const after = await getBot(ownerId, bot.id);
      expect(after?.tokenRevokedAt).toBeGreaterThan(0);
    });

    it('reports that there was nothing to revoke the second time', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Double revoke',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      expect(await revokeBotToken(ownerId, bot.id)).toBe(true);
      // Not an error — the caller's intent is already satisfied — but not a success either.
      expect(await revokeBotToken(ownerId, bot.id)).toBe(false);
    });

    it('stops authenticating a bot whose owner switched it off', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Inactive',
        handle: nextHandle(),
        description: '',
        active: false,
      });
      expect(await botForToken(token)).toBeNull();
      expect((await getBot(ownerId, bot.id))?.active).toBe(false);
    });
  });

  describe('deleting a bot', () => {
    it('removes the bot, its tokens and its ability to authenticate', async () => {
      const { bot, token } = await createBot(ownerId, {
        name: 'Doomed',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      expect(await botForToken(token)).not.toBeNull();

      expect(await deleteBot(ownerId, bot.id)).toBe(true);
      expect(await getBot(ownerId, bot.id)).toBeNull();
      expect(await botForToken(token)).toBeNull();
      expect(await deleteBot(ownerId, bot.id)).toBe(false);

      const tokens = await q('select id from vx_bot_tokens where bot_id = $1', [bot.id]);
      expect(tokens).toHaveLength(0);
    });
  });

  describe('the recorded Telegram identity', () => {
    it('is written by a successful check and cleared by a refusal', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Check recorded',
        handle: nextHandle(),
        description: '',
        active: true,
        telegramToken: TELEGRAM_TOKEN,
      });

      await recordTelegramCheck(ownerId, bot.id, { id: '987654321', username: 'varnox_bot' });
      const ok = await getBot(ownerId, bot.id);
      expect(ok?.telegramBotId).toBe('987654321');
      expect(ok?.telegramUsername).toBe('varnox_bot');
      expect(ok?.telegramCheckedAt).toBeGreaterThan(0);

      // A refusal clears the identity: leaving a stale username on screen after Telegram said no
      // would claim the bot is fine when the last thing that happened to it was a rejection.
      await recordTelegramCheck(ownerId, bot.id, null);
      const cleared = await getBot(ownerId, bot.id);
      expect(cleared?.telegramBotId).toBeNull();
      expect(cleared?.telegramUsername).toBeNull();
      expect(cleared?.telegramCheckedAt).toBeGreaterThan(0);
    });

    it('is not writable on another account’s bot', async () => {
      const { bot } = await createBot(ownerId, {
        name: 'Not writable',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      await recordTelegramCheck(otherId, bot.id, { id: '1', username: 'attacker' });
      expect((await getBot(ownerId, bot.id))?.telegramUsername).toBeNull();
    });
  });

  describe('listing', () => {
    it('returns the newest bot first', async () => {
      const before = await listBots(ownerId);
      const { bot } = await createBot(ownerId, {
        name: 'Newest',
        handle: nextHandle(),
        description: '',
        active: true,
      });
      const after = await listBots(ownerId);
      expect(after[0].id).toBe(bot.id);
      expect(after.length).toBe(before.length + 1);
    });

    it('honours the limit', async () => {
      const limited = await listBots(ownerId, 2);
      expect(limited).toHaveLength(2);
    });
  });
});
