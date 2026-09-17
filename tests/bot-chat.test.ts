import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q } from '../lib/pg';
import { ensureSchema } from '../lib/migrate';
import { saveUser } from '../lib/db';
import { createBot } from '../lib/bots';
import {
  START_COMMAND,
  claimBotInbox,
  getBotThread,
  listBotMessages,
  listBotThreads,
  replyToBotMessage,
  sendBotThreadMessage,
  startBotThread,
} from '../lib/bot-chat';

/**
 * Bot conversations and the queue the bot polls.
 *
 * The assertions that earn their place here are the ones about *taking* work. Reading is easy and
 * hard to get wrong; handing the same message to two pollers is easy to get wrong and invisible when
 * it happens — the account just gets every answer twice, and only under load.
 *
 * Real PostgreSQL, because the claim is an UPDATE whose WHERE clause is the whole mechanism. A mock
 * would be testing the mock.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const run = Math.random().toString(36).slice(2, 10);
const aliceId = `usr_chat_alice_${run}`;
const bobId = `usr_chat_bob_${run}`;

let seq = 0;
function nextHandle(): string {
  seq += 1;
  return `chat${run}${seq}`;
}

async function makeAccount(id: string, username: string) {
  await saveUser({
    id, username, phone: null, email: null, emailVerifiedAt: null, displayName: username, about: '', avatar: null,
    pwHash: 'otp$disabled', createdAt: Date.now(), lastSeen: Date.now(),
  });
}

/** A started bot owned by `owner`, with the greeting already claimed out of the way. */
async function startedBot(owner: string, name = 'Helper') {
  const { bot } = await createBot(owner, {
    name, handle: nextHandle(), description: '', active: true,
  });
  await startBotThread(owner, bot.id);
  await claimBotInbox(bot.id, owner);
  return bot;
}

describe.skipIf(!hasDatabase)('bot conversations', () => {
  beforeAll(async () => {
    await ensureSchema();
    await makeAccount(aliceId, `chatalice_${run}`);
    await makeAccount(bobId, `chatbob_${run}`);
  });

  afterAll(async () => {
    if (hasDatabase) {
      const ids = [aliceId, bobId];
      await q('delete from vx_bot_messages where user_id = any($1)', [ids]);
      await q('delete from vx_bot_threads where user_id = any($1)', [ids]);
      await q('delete from vx_bot_tokens where user_id = any($1)', [ids]);
      await q('delete from vx_bots where user_id = any($1)', [ids]);
      await q('delete from vx_otp_rate where bucket like $1', ['bots:api:%']);
      await q('delete from vx_users where id = any($1)', [ids]);
      await pool().end();
    }
  });

  describe('START', () => {
    it('opens the conversation and greets the bot', async () => {
      const { bot } = await createBot(aliceId, {
        name: 'Fresh', handle: nextHandle(), description: '', active: true,
      });

      const { created } = await startBotThread(aliceId, bot.id);
      expect(created).toBe(true);

      const messages = await listBotMessages(aliceId, bot.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].direction).toBe('in');
      expect(messages[0].body).toBe(START_COMMAND);

      const thread = await getBotThread(aliceId, bot.id);
      expect(thread).not.toBeNull();
      expect(thread!.pending).toBe(1);
    });

    it('is idempotent, and does not greet twice', async () => {
      // A second START must not queue a second /start, or a bot answers "hello" every time somebody
      // taps the button out of curiosity.
      const bot = await startedBot(aliceId, 'Tap twice');
      const again = await startBotThread(aliceId, bot.id);

      expect(again.created).toBe(false);
      const messages = await listBotMessages(aliceId, bot.id);
      expect(messages.filter((m) => m.body === START_COMMAND)).toHaveLength(1);
    });

    it('does nothing for a bot belonging to somebody else', async () => {
      const { bot } = await createBot(aliceId, {
        name: 'Not Bobs', handle: nextHandle(), description: '', active: true,
      });

      const result = await startBotThread(bobId, bot.id);
      expect(result.created).toBe(false);
      // And nothing was written under Bob's name either.
      expect(await getBotThread(bobId, bot.id)).toBeNull();
      expect(await getBotThread(aliceId, bot.id)).toBeNull();
    });
  });

  describe('sending as the account', () => {
    it('needs a started conversation', async () => {
      const { bot } = await createBot(aliceId, {
        name: 'Unstarted', handle: nextHandle(), description: '', active: true,
      });
      // Nothing is created on the fly: START is the point at which a conversation begins.
      expect(await sendBotThreadMessage(aliceId, bot.id, 'hello?')).toBeNull();
      expect(await getBotThread(aliceId, bot.id)).toBeNull();
    });

    it('queues a pending message the bot can take', async () => {
      const bot = await startedBot(aliceId, 'Talker');
      const sent = await sendBotThreadMessage(aliceId, bot.id, 'are you there?');

      expect(sent).not.toBeNull();
      expect(sent!.direction).toBe('in');

      const claimed = await claimBotInbox(bot.id, aliceId);
      expect(claimed.map((m) => m.body)).toEqual(['are you there?']);
    });

    it('cannot write into somebody else’s conversation', async () => {
      const bot = await startedBot(aliceId, 'Mine only');
      expect(await sendBotThreadMessage(bobId, bot.id, 'let me in')).toBeNull();
    });
  });

  describe('the claim', () => {
    it('does not hand the same message out twice', async () => {
      const bot = await startedBot(aliceId, 'Exactly once');
      await sendBotThreadMessage(aliceId, bot.id, 'only once');

      const first = await claimBotInbox(bot.id, aliceId);
      const second = await claimBotInbox(bot.id, aliceId);

      expect(first.map((m) => m.body)).toEqual(['only once']);
      expect(second).toEqual([]);
    });

    it('gives a message to exactly one of two pollers at the same time', async () => {
      // The race the claim exists to close, run as a race. Two replicas behind a load balancer, or
      // a container that was duplicated, would both answer without this.
      const bot = await startedBot(aliceId, 'Contested');
      await sendBotThreadMessage(aliceId, bot.id, 'who gets me');

      const [a, b] = await Promise.all([
        claimBotInbox(bot.id, aliceId),
        claimBotInbox(bot.id, aliceId),
      ]);

      expect(a.length + b.length).toBe(1);
      expect([...a, ...b][0].body).toBe('who gets me');
    });

    it('hands out the oldest first', async () => {
      const bot = await startedBot(aliceId, 'In order');
      await sendBotThreadMessage(aliceId, bot.id, 'first');
      await sendBotThreadMessage(aliceId, bot.id, 'second');

      const claimed = await claimBotInbox(bot.id, aliceId);
      expect(claimed.map((m) => m.body)).toEqual(['first', 'second']);
    });

    it('releases a claim that went stale, so a crashed bot does not keep the message', async () => {
      const bot = await startedBot(aliceId, 'Crashy');
      const sent = await sendBotThreadMessage(aliceId, bot.id, 'still waiting');
      await claimBotInbox(bot.id, aliceId);
      expect(await claimBotInbox(bot.id, aliceId)).toEqual([]);

      /**
       * Age this message's claim past the timeout, which is what a process that died mid-answer
       * looks like. Only this one: the helper's own greeting is also sitting claimed, and ageing
       * every claimed row would make the re-claim return both and prove nothing about which
       * message the release applies to.
       */
      await q('update vx_bot_messages set claimed_at = $1 where id = $2', [
        Date.now() - 10 * 60_000, sent!.id,
      ]);

      const reclaimed = await claimBotInbox(bot.id, aliceId);
      expect(reclaimed.map((m) => m.body)).toEqual(['still waiting']);
    });

    it('cannot take messages out of another bot’s queue', async () => {
      const mine = await startedBot(aliceId, 'Mine');
      const theirs = await startedBot(aliceId, 'Theirs');
      await sendBotThreadMessage(aliceId, theirs.id, 'private');

      // Mine claiming under its own identity gets nothing of theirs...
      expect(await claimBotInbox(mine.id, aliceId)).toEqual([]);
      // ...and their id with my owner id gets nothing at all.
      expect(await claimBotInbox(theirs.id, bobId)).toEqual([]);
      // The message is still theirs to take.
      expect((await claimBotInbox(theirs.id, aliceId)).map((m) => m.body)).toEqual(['private']);
    });
  });

  describe('replying', () => {
    it('turns a claimed message into an answer, both directions on the record', async () => {
      const bot = await startedBot(aliceId, 'Answerer');
      const sent = await sendBotThreadMessage(aliceId, bot.id, 'ping');
      await claimBotInbox(bot.id, aliceId);

      const reply = await replyToBotMessage(bot.id, aliceId, sent!.id, 'pong');
      expect(reply).not.toBeNull();
      expect(reply!.direction).toBe('out');

      const messages = await listBotMessages(aliceId, bot.id);
      expect(messages.map((m) => m.body)).toEqual([START_COMMAND, 'ping', 'pong']);
      expect(messages[messages.length - 1].direction).toBe('out');
      // The account's question is no longer outstanding.
      expect((await getBotThread(aliceId, bot.id))!.pending).toBe(0);
    });

    it('refuses a message it never claimed', async () => {
      // This is what keeps the claim meaningful: a bot cannot answer a message it did not take, so
      // two pollers cannot both reply to one.
      const bot = await startedBot(aliceId, 'Unclaimed');
      const sent = await sendBotThreadMessage(aliceId, bot.id, 'no claim made');
      expect(await replyToBotMessage(bot.id, aliceId, sent!.id, 'too eager')).toBeNull();
    });

    it('refuses to answer the same message twice', async () => {
      const bot = await startedBot(aliceId, 'Once only');
      const sent = await sendBotThreadMessage(aliceId, bot.id, 'one answer please');
      await claimBotInbox(bot.id, aliceId);

      expect(await replyToBotMessage(bot.id, aliceId, sent!.id, 'first')).not.toBeNull();
      expect(await replyToBotMessage(bot.id, aliceId, sent!.id, 'second')).toBeNull();
    });

    it('cannot answer another bot’s message', async () => {
      const mine = await startedBot(aliceId, 'Mine again');
      const theirs = await startedBot(aliceId, 'Theirs again');
      const sent = await sendBotThreadMessage(aliceId, theirs.id, 'not yours');
      await claimBotInbox(theirs.id, aliceId);

      // Same owner, wrong bot — and a different owner with the right bot.
      expect(await replyToBotMessage(mine.id, aliceId, sent!.id, 'hijack')).toBeNull();
      expect(await replyToBotMessage(theirs.id, bobId, sent!.id, 'hijack')).toBeNull();
      // Still answerable by the bot it belongs to.
      expect(await replyToBotMessage(theirs.id, aliceId, sent!.id, 'legitimate')).not.toBeNull();
    });
  });

  describe('the thread list', () => {
    it('summarises the last message and what is outstanding', async () => {
      const bot = await startedBot(aliceId, 'Summarised');
      await sendBotThreadMessage(aliceId, bot.id, 'last thing said');

      const thread = (await listBotThreads(aliceId, bot.id))[0];
      expect(thread.lastBody).toBe('last thing said');
      expect(thread.lastDirection).toBe('in');
      expect(thread.pending).toBe(1);

      await claimBotInbox(bot.id, aliceId);
      await replyToBotMessage(bot.id, aliceId, (await listBotMessages(aliceId, bot.id)).slice(-1)[0].id, 'answered');
      const after = (await listBotThreads(aliceId, bot.id))[0];
      expect(after.lastBody).toBe('answered');
      expect(after.lastDirection).toBe('out');
      expect(after.pending).toBe(0);
    });

    it('never shows one account another account’s conversations', async () => {
      const bot = await startedBot(aliceId, 'Private');
      expect((await listBotThreads(bobId)).map((t) => t.botId)).not.toContain(bot.id);
      expect(await getBotThread(bobId, bot.id)).toBeNull();
      expect(await listBotMessages(bobId, bot.id)).toEqual([]);
    });
  });
});
