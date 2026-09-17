import { q } from './pg';
import { takeRateSlot, type RateSlot } from './db';
import { newId } from './ids';
import type { Bot, CreatedBot } from './types';
import { botTokenMatches, hashBotToken, newBotToken } from './bots-token';
import { openSecret, sealSecret } from './secretbox';

/**
 * The database layer for Varnox-managed bots.
 *
 * TWO RULES, APPLIED WITHOUT EXCEPTION
 *
 * 1. Every statement is scoped by the owner. `user_id` is a parameter of every function here and
 *    appears in every WHERE clause — including the ones that take a bot id, which is the case
 *    that matters. A bot id is not a capability: guessing one must get you nothing. This is the
 *    same rule listBotThread() follows in lib/db.ts, and for the same reason — a check that has
 *    to be remembered at the call site is a check that will eventually not be, whereas a filter
 *    inside the query cannot be forgotten because there is no version of the query without it.
 *
 *    The consequence is that another account's bot reads as *absent* rather than as forbidden.
 *    That is deliberate: a 403 for a bot that exists and a 404 for one that does not would let
 *    an attacker enumerate which ids are real.
 *
 * 2. No secret is ever selected into a value that leaves this file. `telegram_secret` is read in
 *    exactly two functions — the one that opens it to call Telegram, and none other. The list and
 *    detail projections take `(telegram_secret is not null) as has_telegram`: a boolean that
 *    answers "is one on file" without the column's contents ever crossing the wire from Postgres.
 *    That is a stronger guarantee than remembering not to serialise a field, because there is no
 *    field to serialise.
 */

/**
 * The columns every read projects, and the join that finds a bot's current token.
 *
 * Written once and shared, so the "hasTelegram, never telegram_secret" rule cannot drift between
 * the list and the detail query. The lateral join rather than a plain join because it must be the
 * *newest* token — a plain join on the token table would, after a revocation, return the revoked
 * row and the live one and depend on the caller to pick.
 */
const BOT_COLUMNS = `
  b.id,
  b.user_id,
  b.name,
  b.handle,
  b.description,
  b.active,
  (b.telegram_secret is not null) as has_telegram,
  b.telegram_bot_id,
  b.telegram_username,
  b.telegram_checked_at,
  b.created_at,
  b.updated_at,
  t.created_at as token_at,
  t.revoked_at as token_revoked_at
`;

const BOT_SOURCE = `
  from vx_bots b
  left join lateral (
    select created_at, revoked_at
      from vx_bot_tokens
     where bot_id = b.id and user_id = b.user_id
     order by created_at desc
     limit 1
  ) t on true
`;

type BotRow = {
  id: string;
  user_id: string;
  name: string;
  handle: string | null;
  description: string;
  active: boolean;
  has_telegram: boolean;
  telegram_bot_id: string | null;
  telegram_username: string | null;
  telegram_checked_at: number | null;
  created_at: number;
  updated_at: number;
  token_at: number | null;
  token_revoked_at: number | null;
};

/**
 * Narrow a row to the API's shape.
 *
 * Takes the row and returns only named fields rather than spreading it. A spread would carry
 * `has_telegram` and `user_id` outward and, if the projection above ever changed to include
 * `telegram_secret`, would carry that too — with no line of code looking wrong. Naming each
 * field means a new column is invisible until somebody deliberately adds it here.
 */
function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle ?? null,
    description: row.description,
    active: row.active,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    hasTelegram: Boolean(row.has_telegram),
    telegramBotId: row.telegram_bot_id ?? null,
    telegramUsername: row.telegram_username ?? null,
    telegramCheckedAt: row.telegram_checked_at === null ? null : Number(row.telegram_checked_at),
    tokenIssuedAt: row.token_at === null ? null : Number(row.token_at),
    tokenRevokedAt: row.token_revoked_at === null ? null : Number(row.token_revoked_at),
  };
}

/**
 * Whether this handle is already claimed by anybody.
 *
 * Deliberately not scoped by owner, unlike almost every other read here: a handle is unique across
 * the whole app, so the question "is this free" has the same answer for everybody and filtering by
 * owner would answer a different one. This is the single query in this file that is not scoped by
 * user id, and the reason it is safe is that it returns a boolean — it can tell a caller that a
 * name is taken, and nothing else about whose it is.
 */
export async function handleTaken(handle: string): Promise<boolean> {
  const rows = await q<{ id: string }>(
    'select id from vx_bots where lower(handle) = lower($1) limit 1',
    [handle]
  );
  return rows.length > 0;
}

/** How many bots one read returns. Far above what an account will have; a bound, not a page size. */
export const BOTS_PER_READ = 200;

/** One account's bots, newest first. */
export async function listBots(userId: string, limit = BOTS_PER_READ): Promise<Bot[]> {
  const rows = await q<BotRow>(
    `select ${BOT_COLUMNS} ${BOT_SOURCE}
      where b.user_id = $1
      order by b.created_at desc, b.id desc
      limit $2`,
    [userId, limit]
  );
  return rows.map(toBot);
}

/**
 * One bot, or null — including when the id belongs to somebody else.
 *
 * The user id in the WHERE clause is what makes those two cases the same answer, and it is the
 * reason this function can be trusted by a route that has an id from a URL.
 */
export async function getBot(userId: string, botId: string): Promise<Bot | null> {
  const rows = await q<BotRow>(
    `select ${BOT_COLUMNS} ${BOT_SOURCE} where b.user_id = $1 and b.id = $2 limit 1`,
    [userId, botId]
  );
  return rows[0] ? toBot(rows[0]) : null;
}

export type CreateBotInput = {
  name: string;
  /** The Varnox handle, already lowercased and format-checked by the route. */
  handle: string;
  description: string;
  active: boolean;
  /** The Telegram bot token, already validated for shape. Sealed before it reaches the table. */
  telegramToken?: string;
};

/**
 * Create a bot and issue its first token, in one statement.
 *
 * A single statement rather than two, because this codebase has no transaction helper and adding
 * one for this would be the wrong shape: lib/db.ts is written throughout as atomic single
 * statements, and a CREATE that can half-succeed — a bot row with no token, invisible in the UI
 * because the token it was supposed to show was never written — is precisely the failure that
 * pattern exists to avoid. Two data-modifying CTEs run in one implicit transaction, so either
 * both rows land or neither does.
 *
 * The plaintext token is returned to the caller and nowhere else. It is not logged, not stored,
 * and not derivable afterwards: the row holds only its hash.
 */
export async function createBot(userId: string, input: CreateBotInput): Promise<CreatedBot> {
  const now = Date.now();
  const botId = newId('bot');
  const tokenId = newId('btk');
  const token = newBotToken();
  const tokenHash = hashBotToken(token);
  // Sealed here rather than accepted sealed: the only place a plaintext Telegram token exists in
  // this process is this argument, and the encryption happens before the value can be stored.
  const telegramSecret = input.telegramToken ? sealSecret(input.telegramToken) : null;

  let rows: BotRow[];
  try {
    rows = await q<BotRow>(
      `with b as (
       insert into vx_bots
         (id, user_id, name, handle, description, active, telegram_secret, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       returning *
     ), t as (
       insert into vx_bot_tokens (id, bot_id, user_id, token_hash, created_at)
       select $9, b.id, b.user_id, $10, $8 from b
       returning created_at, revoked_at
     )
     select ${BOT_COLUMNS} from b join t on true`,
    [
      botId,
      userId,
      input.name,
      input.handle,
      input.description,
      input.active,
      telegramSecret,
      now,
      tokenId,
      tokenHash,
      ]
    );
  } catch (err) {
    /**
     * The handle check the route did before calling this is advisory; this is the one that makes
     * the guarantee true.
     *
     * Two requests can pass the pre-check in the same instant, and only the unique index settles
     * which one wins. Translating its violation into a sentence is the difference between a
     * second caller being told to pick another name and being told the server broke — the
     * violation's own message names an index, which is nothing to anybody outside this file.
     */
    if (isUniqueViolation(err)) {
      // `cause` keeps the driver's error attached. Nothing reads it today, but a rethrow that drops
      // the original makes the one hard case — an index doing something surprising — undebuggable
      // from the logs, and the next person to look will want the constraint name that is in it.
      throw new Error('That username is already taken. Try another.', { cause: err });
    }
    throw err;
  }

  const row = rows[0];
  if (!row) throw new Error('The bot was not created');
  return { bot: toBot(row), token };
}

/**
 * Revoke the bot's live token, if it has one.
 *
 * Only ever moves a null `revoked_at` to a timestamp, and only for the signed-in owner's own
 * bot. Returns whether a token was actually revoked, so a route can say "there was nothing to
 * revoke" rather than reporting a success that did not happen — the difference between a UI that
 * is honest and one that quietly lies.
 *
 * The row is not deleted. Its hash stays, so the token remains identifiable as one that existed
 * and was withdrawn, and there is no window in which a half-finished delete leaves the token
 * verifiable.
 */
export async function revokeBotToken(userId: string, botId: string): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `update vx_bot_tokens
        set revoked_at = $3
      where bot_id = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [botId, userId, Date.now()]
  );
  return rows.length > 0;
}

/**
 * Delete a bot and its tokens.
 *
 * Both deletes in one statement, and both scoped by owner. Scoped by owner rather than by the
 * bot id alone because the sweep of tokens is keyed on a bot id that came from a URL: without the
 * user id it would be a way to delete another account's tokens by naming their bot.
 *
 * Returns false when the bot was not this account's — including when it does not exist.
 */
export async function deleteBot(userId: string, botId: string): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `with gone as (
       delete from vx_bots where id = $1 and user_id = $2 returning id
     ), swept as (
       delete from vx_bot_tokens where bot_id in (select id from gone) and user_id = $2 returning id
     )
     select id from gone`,
    [botId, userId]
  );
  return rows.length > 0;
}

/**
 * The bot's Telegram token, decrypted, or null.
 *
 * The only function in the app that returns this value, and it is called from exactly one place:
 * the server route that is about to put it in a request to Telegram. Null covers "no token on
 * file" and "the sealed value can no longer be opened" together — the second happens when the
 * key changed since the token was saved — because the operator's next move is the same in both
 * cases, which is to save the token again.
 */
export async function botTelegramToken(userId: string, botId: string): Promise<string | null> {
  const rows = await q<{ telegram_secret: string | null }>(
    'select telegram_secret from vx_bots where id = $1 and user_id = $2 limit 1',
    [botId, userId]
  );
  if (!rows[0]) return null;
  return openSecret(rows[0].telegram_secret);
}

/**
 * Record what getMe said, so the list can show which bot the token belongs to.
 *
 * Called after a successful test and after a failed one alike: `info` is null for a failure, and
 * that clears the recorded identity. Leaving a stale id and username on screen after a token was
 * rejected would claim the bot is fine when the last thing that happened to it was a refusal.
 *
 * `telegram_checked_at` is set either way — it dates the last attempt, which is what makes a
 * recorded answer readable as "as of this moment" rather than as a permanent fact.
 */
export async function recordTelegramCheck(
  userId: string,
  botId: string,
  info: { id: string; username: string } | null
): Promise<void> {
  const now = Date.now();
  await q(
    `update vx_bots
        set telegram_bot_id = $3, telegram_username = $4, telegram_checked_at = $5, updated_at = $5
      where id = $1 and user_id = $2`,
    [botId, userId, info?.id ?? null, info?.username ?? null, now]
  );
}

/**
 * The bot a Varnox API token belongs to, or null.
 *
 * This is the entry point a bot uses to authenticate with the token minted for it, and it is what
 * gives "revoked" a meaning: a revoked token is refused here because the lookup only accepts a
 * row whose `revoked_at` is null, so revocation ends a token's life at the next request rather
 * than at some later sweep.
 *
 * The owner's own `active` switch is checked too, and the bot is only returned when it is on.
 * The two are not redundant: revocation withdraws a credential, while `active` says whether the
 * bot is meant to be running at all — and an owner who flips a switch labelled active expects it
 * to stop working immediately, not to keep authenticating until somebody remembers to revoke.
 * Failing closed on both is the only reading that matches what the switch appears to promise.
 *
 * The comparison is constant-time (see botTokenMatches). The lookup by hash happens first because
 * it is indexed and there is no way to search on an unhashed secret without reading every row —
 * and searching on a SHA-256 of the presented value leaks nothing useful, as a hash has no
 * partial-match structure to walk. The timing-safe compare then re-checks the row it found, so
 * the final decision never rests on a byte-by-byte `=` in the query planner.
 */
export async function botForToken(presented: string): Promise<Bot | null> {
  const rows = await q<BotRow & { token_hash: string }>(
    `select ${BOT_COLUMNS}, t.token_hash
       from vx_bot_tokens t
       join vx_bots b on b.id = t.bot_id and b.user_id = t.user_id
      where t.token_hash = $1 and t.revoked_at is null and b.active
      limit 1`,
    [hashBotToken(presented)]
  );

  const row = rows[0];
  if (!row) return null;
  if (!botTokenMatches(presented, row.token_hash)) return null;
  return toBot(row);
}

/**
 * Whether a thrown value is PostgreSQL's unique-violation.
 *
 * 23505 is the SQLSTATE for it. Narrowing on the code alone rather than on the constraint name
 * keeps this working if the index is ever renamed, and matching on the code rather than on the
 * message keeps it working across locales.
 */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
}

/* ── rate limiting ─────────────────────────────────────────────────────────── */

/**
 * Per-account buckets for the bot routes.
 *
 * None of these protect a resource that costs money, the way the SMS limits do. What they
 * protect is the database and the bot API server: without a ceiling, an authenticated account
 * could create bots in a loop — each creation writes two rows and mints a token — or point the
 * test action at the bot API server as fast as it will answer, and make the operator's own
 * infrastructure the thing that falls over. A rate limit is the cheapest way to make that
 * somebody else's problem rather than the server's.
 *
 * Separate buckets per action rather than one shared allowance, because the actions have
 * genuinely different natural rates: creating twenty bots in an hour is a script, whereas testing
 * one bot's Telegram token a few times while pasting it in is a person. Sharing a bucket would
 * make one of those limits wrong.
 *
 * The bucket key includes the account id, so one account exhausting its allowance cannot spend
 * another's — the same per-caller rule lib/otp.ts follows for sends.
 */
export const BOT_LIMITS = {
  create: { windowMs: 60 * 60_000, limit: 20, what: 'bots created' },
  mutate: { windowMs: 5 * 60_000, limit: 60, what: 'changes' },
  test: { windowMs: 5 * 60_000, limit: 30, what: 'Telegram tests' },
} as const;

export type BotAction = keyof typeof BOT_LIMITS;

/**
 * Take one slot from this account's bucket for an action.
 *
 * The `bots:` prefix keeps these out of the namespace the app's other buckets use — the OTP
 * limits and the bot bridge both key into vx_otp_rate, and a bucket name that collided would let
 * one feature's traffic spend another's allowance.
 */
export async function botRateSlot(userId: string, action: BotAction): Promise<RateSlot> {
  const { windowMs, limit } = BOT_LIMITS[action];
  return takeRateSlot(`bots:${action}:${userId}`, windowMs, limit);
}

/**
 * What to tell a caller who has run out.
 *
 * Names the action and the wait, because "rate limited" leaves the person guessing whether to
 * wait a second or an hour. Rounded up and floored at a minute so it never reads "try again in
 * 0 min", which looks like a bug.
 */
export function botRateMessage(action: BotAction, retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many ${BOT_LIMITS[action].what}. Try again in ${minutes} min.`;
}
