import { pool } from './pg';

/**
 * Bring the database up to the shape this code needs — once per process.
 *
 * This exists because a Vercel deploy and a database migration are two separate acts, and
 * nothing stops them getting out of step. When they do, the failure is particularly
 * confusing: the code ships, the column does not exist, and the symptoms look like several
 * unrelated bugs. Adding one column made the display picture stop saving, new signups fail,
 * email sign-in error, and — least obviously — sign-in with a *correct* password fail,
 * because signing in updates `last_seen`, while a wrong password returns early and looks
 * perfectly healthy.
 *
 * So the app now closes that gap itself: the statements below are the idempotent part of
 * db/schema.sql, and they run on the first request a process handles. Every one is
 * `if not exists`, so running them against a current database is a no-op. Set
 * AUTO_MIGRATE=0 to turn this off and manage the schema by hand.
 *
 * What this deliberately does NOT do: data migrations, dropping anything, or rewriting
 * rows. Those stay in db/schema.sql, where a slow or surprising statement belongs, run
 * deliberately rather than behind a login request.
 */

/** Statements are labelled so a failure names the object rather than a line number. */
const STATEMENTS: [label: string, sql: string][] = [
  ['vx_users.email', `alter table vx_users add column if not exists email text`],
  [
    'vx_users_email_unique',
    `create unique index if not exists vx_users_email_unique
       on vx_users (lower(email)) where email is not null`,
  ],
  [
    'vx_otp',
    `create table if not exists vx_otp (
       phone       text primary key,
       code_hash   text not null,
       sent_at     bigint not null,
       expires_at  bigint not null,
       attempts    integer not null default 0,
       consumed_at bigint,
       sent_ip     text
     )`,
  ],
  ['vx_otp_expires', `create index if not exists vx_otp_expires on vx_otp (expires_at)`],
  [
    'vx_otp_rate',
    `create table if not exists vx_otp_rate (
       bucket        text primary key,
       count         integer not null default 0,
       window_start  bigint not null,
       blocked_until bigint not null default 0
     )`,
  ],
  [
    'vx_otp_rate_window',
    `create index if not exists vx_otp_rate_window on vx_otp_rate (window_start)`,
  ],
  ['vx_media.once', `alter table vx_media add column if not exists once boolean not null default false`],
  [
    'vx_messages.once',
    `alter table vx_messages add column if not exists once boolean not null default false`,
  ],
  [
    'vx_msg_views',
    `create table if not exists vx_msg_views (
       message_id text not null,
       user_id    text not null,
       viewed_at  bigint not null,
       primary key (message_id, user_id)
     )`,
  ],
];

/** Any value, as long as every instance of this app uses the same one. */
const LOCK_KEY = 727001;

export type MigrationReport = { ran: boolean; applied: string[]; failed: string | null };

let started: Promise<MigrationReport> | null = null;

/**
 * Runs at most once per process. Failures are not cached, so a transient problem gets
 * another chance on a later request instead of poisoning the instance forever.
 */
export function ensureSchema(): Promise<MigrationReport> {
  if (process.env.AUTO_MIGRATE === '0') {
    return Promise.resolve({ ran: false, applied: [], failed: null });
  }
  if (!started) started = run();
  return started;
}

/**
 * Errors that mean "someone already did this", which is a success for our purposes:
 * 42P07 duplicate_table, 42710 duplicate_object.
 */
function alreadyDone(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P07' || code === '42710';
}

async function run(): Promise<MigrationReport> {
  const applied: string[] = [];
  let client;
  try {
    client = await pool().connect();
  } catch (err) {
    // No database at all: leave it to the individual request to report its own failure.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[varnox] auto-migration could not connect:', message);
    started = null;
    return { ran: false, applied, failed: message };
  }

  try {
    // One client for the whole sequence, so the advisory lock is held on the same session
    // that does the work — with a pool, lock and unlock could otherwise land on different
    // connections. Two cold starts racing the same DDL is how you get a catalogue error.
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      for (const [label, sql] of STATEMENTS) {
        try {
          await client.query(sql);
          applied.push(label);
        } catch (err) {
          if (alreadyDone(err)) continue;
          throw err;
        }
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
    if (applied.length) console.log('[varnox] auto-migration applied:', applied.join(', '));
    return { ran: true, applied, failed: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[varnox] auto-migration failed:', message);
    // Most likely causes, named so the log is actionable rather than cryptic.
    if ((err as { code?: string } | null)?.code === '42P07') {
      console.error('[varnox]   a table already exists with a different shape');
    } else if ((err as { code?: string } | null)?.code === '23505') {
      console.error('[varnox]   duplicate values exist, so the unique index cannot be built');
    } else if (/permission denied/i.test(message)) {
      console.error('[varnox]   the database role may not be allowed to change the schema');
    }
    started = null;
    return { ran: false, applied, failed: message };
  } finally {
    client.release();
  }
}
