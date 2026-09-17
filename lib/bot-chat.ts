import { q } from './pg';
import { newId } from './ids';
import type { BotMessage, BotMessageDirection, BotThread } from './types';

/**
 * Conversations with bots, and the queue the bot's own process polls.
 *
 * TWO AUDIENCES, ONE TABLE
 *
 * The account reads this data through a session cookie and sees a conversation. The bot reads it
 * through a token and sees a queue of work. Both are the same rows, which is the point: a message
 * the account sends is not "sent" anywhere — it is written down, and the bot picks it up when it
 * next asks. Nothing is pushed, and the bot can be offline for a week without anything failing.
 *
 * The two audiences are scoped differently, and the difference is deliberate:
 *
 *   - The account's reads are scoped by `user_id`: you see your own conversations and nothing else.
 *   - The bot's reads are scoped by `bot_id`, which is also a `user_id` in every query. A bot may
 *     only touch messages belonging to its own owner, so a token cannot be used to read or claim
 *     anything on another account even if a bot id is guessed.
 *
 * CLAIMING, AND WHY IT IS NOT JUST A READ
 *
 * `claimBotInbox` moves a message out of `pending`, so the same message is not handed to two
 * pollers. That sounds like a nicety and is not: a bot process that restarts, or two replicas
 * behind a load balancer, or a Pterodactyl container that is duplicated, would each answer the
 * same message and the account would get the reply twice. The claim is what makes "the bot" a
 * thing that can be run more than once by accident without anybody noticing.
 *
 * The claim also expires. A bot that crashes between claiming and replying would otherwise leave
 * the message locked forever, and the account's message would never be answered by anyone. So a
 * claim older than STALE_CLAIM_MS becomes claimable again — the crash costs a delay, not the
 * message.
 */

/** How many messages a read returns when the caller does not say. */
export const MESSAGES_PER_READ = 100;

/** The most the inbox will hand out in one claim. */
export const INBOX_BATCH = 10;

/** How large a single message may be. Long enough for a genuine answer, short enough to bound a row. */
export const MESSAGE_MAX = 4000;

/**
 * How long a claim is respected before the message becomes claimable again.
 *
 * Five minutes: far longer than any sane handler takes, far shorter than a person would wait before
 * concluding their bot is broken. Too short and a slow bot has its message taken away mid-answer,
 * producing two replies; too long and a crashed bot leaves the message unanswered for longer than
 * anybody will keep watching.
 */
export const STALE_CLAIM_MS = 5 * 60_000;

/** What pressing START sends. The same convention Telegram uses, so bots written for it port over. */
export const START_COMMAND = '/start';

type MessageRow = {
  id: string;
  direction: string;
  body: string;
  created_at: number;
};

type ThreadRow = {
  bot_id: string;
  created_at: number;
  updated_at: number;
  last_body: string | null;
  last_direction: string | null;
  last_at: number | null;
  pending: number;
};

function toMessage(row: MessageRow): BotMessage {
  return {
    id: row.id,
    // Anything that is not exactly 'out' reads as 'in'. A row with an unexpected value is a bug,
    // and the safe reading of a message of unknown provenance is the one that came from the person
    // rather than the one that claims to be an answer.
    direction: row.direction === 'out' ? 'out' : 'in',
    body: row.body,
    createdAt: Number(row.created_at),
  };
}

function toThread(row: ThreadRow): BotThread {
  return {
    botId: row.bot_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastBody: row.last_body,
    lastDirection: (row.last_direction === 'out' ? 'out' : row.last_direction === 'in' ? 'in' : null) as
      | BotMessageDirection
      | null,
    lastAt: row.last_at === null ? null : Number(row.last_at),
    pending: Number(row.pending),
  };
}

const THREAD_COLUMNS = `
  t.bot_id,
  t.created_at,
  t.updated_at,
  m.body   as last_body,
  m.direction as last_direction,
  m.created_at as last_at,
  p.pending
`;

/**
 * The last message and the outstanding count, joined onto the thread.
 *
 * Laterals rather than two more queries per row: the list is one round trip regardless of how many
 * threads there are, which matters because the alternative gets slower exactly as an account gets
 * more interesting to look at.
 *
 * The newest message is found by `seq`. See the note on that column in db/schema.sql: a millisecond
 * stamp ties, and breaking a tie with the primary key orders a conversation randomly.
 */
const THREAD_SOURCE = `
  from vx_bot_threads t
  left join lateral (
    select body, direction, created_at
      from vx_bot_messages
     where bot_id = t.bot_id and user_id = t.user_id
     order by seq desc
     limit 1
  ) m on true
  left join lateral (
    select count(*)::int as pending
      from vx_bot_messages
     where bot_id = t.bot_id and user_id = t.user_id and direction = 'in' and status = 'pending'
  ) p on true
`;

/**
 * This account's bot conversations, most recently active first.
 *
 * `botId` narrows it to one, which is how the thread view gets its header without a second query
 * shape. Null means every thread.
 */
export async function listBotThreads(userId: string, botId?: string): Promise<BotThread[]> {
  const rows = await q<ThreadRow>(
    `select ${THREAD_COLUMNS} ${THREAD_SOURCE}
      where t.user_id = $1 and ($2::text is null or t.bot_id = $2)
      order by t.updated_at desc`,
    [userId, botId ?? null]
  );
  return rows.map(toThread);
}

/** One thread, or null — including when the bot is not this account's. */
export async function getBotThread(userId: string, botId: string): Promise<BotThread | null> {
  const rows = await listBotThreads(userId, botId);
  return rows[0] ?? null;
}

/**
 * Open the conversation with a bot, and greet it.
 *
 * Idempotent, and that is the whole design of the function. The thread row is keyed by bot id with
 * an `on conflict do nothing`, so a second START changes nothing — it does not create a second
 * conversation and it does not queue a second `/start`, which would make a bot answer "hello"
 * again every time somebody tapped the button out of curiosity.
 *
 * The greeting is queued only when the thread is genuinely new, which is what the CTE arrangement
 * expresses: the message insert selects `from t`, and `t` has a row only if the thread insert
 * actually happened.
 *
 * The insert is also conditioned on the bot belonging to the caller. The route checks that too —
 * this is the version that cannot be forgotten, because it is in the statement rather than at a
 * call site. A bot id belonging to somebody else inserts nothing, so START does nothing and reports
 * that nothing happened.
 *
 * Returns whether the thread was created, so the caller can tell "started" from "already started".
 */
export async function startBotThread(
  userId: string,
  botId: string
): Promise<{ created: boolean }> {
  const now = Date.now();
  const rows = await q<{ created: number }>(
    `with t as (
       insert into vx_bot_threads (bot_id, user_id, created_at, updated_at)
       select $1, $2, $3, $3
        where exists (select 1 from vx_bots where id = $1 and user_id = $2)
       on conflict (bot_id) do nothing
       returning bot_id
     ), m as (
       insert into vx_bot_messages (id, bot_id, user_id, direction, body, status, created_at)
       select $4, $1, $2, 'in', $5, 'pending', $3 from t
       returning id
     )
     select (select count(*)::int from t) as created`,
    [botId, userId, now, newId('bmsg'), START_COMMAND]
  );
  return { created: Number(rows[0]?.created ?? 0) > 0 };
}

/**
 * The conversation's messages, oldest first.
 *
 * Read newest-first with a limit and then reversed, rather than oldest-first with a limit: an
 * "oldest 100" of a long conversation is the beginning of it, which is never what a chat view
 * wants. This is the newest 100, shown in order.
 */
export async function listBotMessages(
  userId: string,
  botId: string,
  limit = MESSAGES_PER_READ
): Promise<BotMessage[]> {
  const rows = await q<MessageRow>(
    `select id, direction, body, created_at
       from vx_bot_messages
      where bot_id = $1 and user_id = $2
      order by seq desc
      limit $3`,
    [botId, userId, limit]
  );
  return rows.map(toMessage).reverse();
}

/**
 * The account says something to its bot.
 *
 * Written as a pending inbound message, which is what "sent" means here: nothing was delivered,
 * something was made available. The thread's `updated_at` moves in the same statement so the
 * conversation rises to the top of the list — a second statement would leave a window where the
 * message exists and the list disagrees.
 *
 * Returns null when there is no thread, which is the caller's signal that START has not happened.
 * Requiring a thread rather than creating one on the fly keeps START meaningful: it is the point at
 * which a conversation begins, and a bot that has never been started has nothing to answer.
 */
export async function sendBotThreadMessage(
  userId: string,
  botId: string,
  body: string
): Promise<BotMessage | null> {
  const now = Date.now();
  const rows = await q<MessageRow>(
    `with m as (
       insert into vx_bot_messages (id, bot_id, user_id, direction, body, status, created_at)
       select $1, $2, $3, 'in', $4, 'pending', $5
        where exists (select 1 from vx_bot_threads where bot_id = $2 and user_id = $3)
       returning id, direction, body, created_at
     ), t as (
       update vx_bot_threads set updated_at = $5
        where bot_id = $2 and user_id = $3 and exists (select 1 from m)
       returning bot_id
     )
     select id, direction, body, created_at from m`,
    [newId('bmsg'), botId, userId, body, now]
  );
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Take the oldest pending messages for a bot, and mark them taken.
 *
 * The claim and the read are one statement, so there is no moment between deciding a message is
 * yours and it becoming yours — which is the moment two pollers would both win. `for update skip
 * locked` means a concurrent claim does not block; it simply moves on to the next row, so two
 * pollers divide the work between them instead of one waiting.
 *
 * Messages whose claim has gone stale are claimable again, so a bot that died mid-answer does not
 * take its message with it.
 *
 * Scoped by both bot id and owner id. The owner id comes from the token, not from the request, so
 * there is no way to ask for another account's queue.
 */
export async function claimBotInbox(
  botId: string,
  userId: string,
  limit = INBOX_BATCH
): Promise<BotMessage[]> {
  const now = Date.now();
  const staleBefore = now - STALE_CLAIM_MS;
  const rows = await q<MessageRow>(
    `with claimable as (
       select id
         from vx_bot_messages
        where bot_id = $1
          and user_id = $2
          and direction = 'in'
          and (status = 'pending' or (status = 'claimed' and claimed_at < $3))
        order by seq
        limit $4
        for update skip locked
     ), claimed as (
       update vx_bot_messages m
          set status = 'claimed', claimed_at = $5, error = null
         from claimable c
        where m.id = c.id
       returning m.id, m.direction, m.body, m.created_at, m.seq
     )
     -- seq is ordered on but not selected: it is a column of the CTE, not of the result, and
     -- leaving it out of the output keeps the ordering an implementation detail of this query
     -- rather than something a caller could start depending on.
     select id, direction, body, created_at from claimed order by seq`,
    [botId, userId, staleBefore, limit, now]
  );
  return rows.map(toMessage);
}

/**
 * The bot answers one of its messages.
 *
 * One statement again, and the sequence matters: the inbound row is moved to `acted` and the reply
 * is inserted in the same transaction, so there is no version of events where the account sees a
 * reply to a message the queue still thinks is unanswered, or where a message is marked answered
 * with no answer to show for it.
 *
 * Only a claimed message can be answered. That is what keeps the reply tied to a claim — a bot
 * cannot answer a message it never took, which is the case that would let two pollers both reply.
 * The alternative, accepting any inbound id, would make the claim advisory.
 *
 * Returns null when the id was not a claimed inbound message for this bot, which covers "no such
 * message", "already answered", "somebody else's" and "never claimed" with one answer.
 */
export async function replyToBotMessage(
  botId: string,
  userId: string,
  messageId: string,
  body: string
): Promise<BotMessage | null> {
  const now = Date.now();
  const rows = await q<MessageRow>(
    `with done as (
       update vx_bot_messages
          set status = 'acted', acted_at = $4
        where id = $1 and bot_id = $2 and user_id = $3
          and direction = 'in' and status = 'claimed'
       returning bot_id, user_id
     ), reply as (
       insert into vx_bot_messages (id, bot_id, user_id, direction, body, status, created_at)
       select $5, d.bot_id, d.user_id, 'out', $6, 'done', $4 from done d
       returning id, direction, body, created_at
     ), t as (
       update vx_bot_threads set updated_at = $4
        where bot_id = $2 and user_id = $3 and exists (select 1 from reply)
       returning bot_id
     )
     select id, direction, body, created_at from reply`,
    [messageId, botId, userId, now, newId('bmsg'), body]
  );
  return rows[0] ? toMessage(rows[0]) : null;
}
