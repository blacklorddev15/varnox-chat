import { q } from './pg';

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
 * Set AUTO_MIGRATE=0 to turn this off and manage the schema by hand.
 *
 * TWO THINGS LEARNED THE HARD WAY, both fixed here:
 *
 * 1. No advisory lock. The connection string points at Neon's transaction-mode pooler,
 *    which hands each query to whichever backend is free. A session-level lock taken by one
 *    query can then be held by a backend that later serves other clients, and the matching
 *    "unlock" can land on a different backend and do nothing at all. A lock that is taken
 *    but never released hangs every later request that waits for it — which is exactly what
 *    happened: the API answered in 0.3s, then hung past 60s, then recovered when that
 *    backend was recycled, and would have hung again. A lock is the wrong tool here: every
 *    statement is `if not exists` and duplicate-object errors are tolerated (see
 *    alreadyDone), so no mutual exclusion is needed.
 * 2. Nothing to do on a healthy database. The previous version ran all the DDL on every
 *    cold start, which is pointless work inside the request path. Now one query asks what
 *    is missing, and only that runs.
 *
 * What this deliberately does NOT do: data migrations, dropping anything, or rewriting rows.
 * Those stay in db/schema.sql, where a slow or surprising statement belongs, run deliberately
 * rather than behind a login request.
 */

type Step = {
  /** How the object is looked up, so only genuinely missing work is attempted. */
  kind: 'column' | 'table' | 'index';
  label: string;
  sql: string;
};

export const STEPS: Step[] = [
  {
    kind: 'column',
    label: 'vx_users.email',
    sql: `alter table vx_users add column if not exists email text`,
  },
  {
    kind: 'index',
    label: 'vx_users_email_unique',
    sql: `create unique index if not exists vx_users_email_unique
            on vx_users (lower(email)) where email is not null`,
  },
  {
    kind: 'table',
    label: 'vx_otp',
    sql: `create table if not exists vx_otp (
            phone       text primary key,
            code_hash   text not null,
            sent_at     bigint not null,
            expires_at  bigint not null,
            attempts    integer not null default 0,
            consumed_at bigint,
            sent_ip     text
          )`,
  },
  {
    kind: 'index',
    label: 'vx_otp_expires',
    sql: `create index if not exists vx_otp_expires on vx_otp (expires_at)`,
  },
  {
    kind: 'table',
    label: 'vx_otp_rate',
    sql: `create table if not exists vx_otp_rate (
            bucket        text primary key,
            count         integer not null default 0,
            window_start  bigint not null,
            blocked_until bigint not null default 0
          )`,
  },
  {
    kind: 'index',
    label: 'vx_otp_rate_window',
    sql: `create index if not exists vx_otp_rate_window on vx_otp_rate (window_start)`,
  },
  {
    kind: 'column',
    label: 'vx_media.once',
    sql: `alter table vx_media add column if not exists once boolean not null default false`,
  },
  {
    kind: 'column',
    label: 'vx_messages.once',
    sql: `alter table vx_messages add column if not exists once boolean not null default false`,
  },
  {
    kind: 'column',
    label: 'vx_messages.payload',
    sql: `alter table vx_messages add column if not exists payload jsonb`,
  },
  {
    kind: 'table',
    label: 'vx_msg_views',
    sql: `create table if not exists vx_msg_views (
            message_id text not null,
            user_id    text not null,
            viewed_at  bigint not null,
            primary key (message_id, user_id)
          )`,
  },
  {
    kind: 'table',
    label: 'vx_devices',
    sql: `create table if not exists vx_devices (
            id         text primary key,
            user_id    text not null,
            label      text,
            user_agent text,
            ip         text,
            created_at bigint not null,
            last_seen  bigint not null,
            revoked_at bigint
          )`,
  },
  {
    kind: 'table',
    label: 'vx_link_codes',
    sql: `create table if not exists vx_link_codes (
            code           text primary key,
            user_id        text not null,
            created_at     bigint not null,
            expires_at     bigint not null,
            consumed_at    bigint,
            consumed_agent text
          )`,
  },
  {
    kind: 'table',
    label: 'vx_status',
    sql: `create table if not exists vx_status (
            id         text primary key,
            user_id    text not null,
            kind       text not null,
            text       text,
            media_url  text,
            bg         text,
            created_at bigint not null,
            expires_at bigint not null
          )`,
  },
  {
    kind: 'index',
    label: 'vx_status_expires',
    sql: `create index if not exists vx_status_expires on vx_status (expires_at)`,
  },
  {
    kind: 'table',
    label: 'vx_status_views',
    sql: `create table if not exists vx_status_views (
            status_id text not null,
            viewer_id text not null,
            viewed_at bigint not null,
            primary key (status_id, viewer_id)
          )`,
  },
  {
    kind: 'table',
    label: 'vx_channels',
    sql: `create table if not exists vx_channels (
            id text primary key,
            owner_id text not null,
            name text not null,
            description text,
            avatar text,
            created_at bigint not null
          )`,
  },
  {
    kind: 'index',
    label: 'vx_channels_owner',
    sql: `create index if not exists vx_channels_owner on vx_channels (owner_id)`,
  },
  {
    kind: 'table',
    label: 'vx_channel_follows',
    sql: `create table if not exists vx_channel_follows (
            channel_id text not null,
            user_id text not null,
            followed_at bigint not null,
            last_read_at bigint not null default 0,
            primary key (channel_id, user_id)
          )`,
  },
  {
    kind: 'index',
    label: 'vx_channel_follows_user',
    sql: `create index if not exists vx_channel_follows_user on vx_channel_follows (user_id)`,
  },
  {
    kind: 'table',
    label: 'vx_channel_posts',
    sql: `create table if not exists vx_channel_posts (
            id text primary key,
            channel_id text not null,
            author_id text not null,
            kind text not null,
            text text,
            media_url text,
            created_at bigint not null
          )`,
  },
  {
    kind: 'index',
    label: 'vx_channel_posts_channel',
    sql: `create index if not exists vx_channel_posts_channel
            on vx_channel_posts (channel_id, created_at desc)`,
  },
  {
    kind: 'table',
    label: 'vx_calls',
    sql: `create table if not exists vx_calls (
            id          text primary key,
            caller_id   text not null,
            callee_id   text not null,
            kind        text not null,
            status      text not null,
            created_at  bigint not null,
            answered_at bigint,
            ended_at    bigint,
            ended_by    text
          )`,
  },
  {
    kind: 'index',
    label: 'vx_calls_callee',
    sql: `create index if not exists vx_calls_callee on vx_calls (callee_id, status)`,
  },
  {
    kind: 'index',
    label: 'vx_calls_caller',
    sql: `create index if not exists vx_calls_caller on vx_calls (caller_id, created_at desc)`,
  },
  {
    kind: 'table',
    label: 'vx_call_signals',
    sql: `create table if not exists vx_call_signals (
            seq        bigserial primary key,
            call_id    text not null,
            from_id    text not null,
            kind       text not null,
            payload    text not null,
            created_at bigint not null
          )`,
  },
  {
    kind: 'index',
    label: 'vx_call_signals_call',
    sql: `create index if not exists vx_call_signals_call on vx_call_signals (call_id, seq)`,
  },
  {
    kind: 'table',
    label: 'varnox_pairing_requests',
    sql: `create table if not exists varnox_pairing_requests (
            id           serial primary key,
            user_id      text not null,
            phone        text not null,
            status       text not null default 'pending',
            pairing_code text,
            error        text,
            expires_at   timestamptz not null,
            created_at   timestamptz not null default now(),
            updated_at   timestamptz not null default now()
          )`,
  },
  {
    kind: 'index',
    label: 'varnox_pairing_requests_status',
    sql: `create index if not exists varnox_pairing_requests_status
            on varnox_pairing_requests (status, expires_at)`,
  },
  {
    kind: 'index',
    label: 'varnox_pairing_requests_user',
    sql: `create index if not exists varnox_pairing_requests_user
            on varnox_pairing_requests (user_id, updated_at desc)`,
  },
  {
    kind: 'table',
    label: 'varnox_sessions',
    sql: `create table if not exists varnox_sessions (
            id         text primary key,
            phone      text,
            status     text,
            updated_at timestamptz not null default now()
          )`,
  },
  {
    kind: 'table',
    label: 'varnox_bot_inbound',
    sql: `create table if not exists varnox_bot_inbound (
            id         bigserial primary key,
            session_id text not null,
            user_id    text not null,
            body       text not null,
            status     text not null default 'pending',
            error      text,
            created_at timestamptz not null default now(),
            claimed_at timestamptz,
            acted_at   timestamptz
          )`,
  },
  {
    kind: 'index',
    label: 'varnox_bot_inbound_claim',
    sql: `create index if not exists varnox_bot_inbound_claim
            on varnox_bot_inbound (status, created_at)`,
  },
  {
    kind: 'index',
    label: 'varnox_bot_inbound_thread',
    sql: `create index if not exists varnox_bot_inbound_thread
            on varnox_bot_inbound (session_id, id desc)`,
  },
  {
    kind: 'table',
    label: 'varnox_bot_outbound',
    sql: `create table if not exists varnox_bot_outbound (
            id         bigserial primary key,
            session_id text not null,
            user_id    text not null,
            inbound_id bigint,
            kind       text not null default 'text',
            body       text,
            created_at timestamptz not null default now()
          )`,
  },
  {
    kind: 'index',
    label: 'varnox_bot_outbound_thread',
    sql: `create index if not exists varnox_bot_outbound_thread
            on varnox_bot_outbound (session_id, id)`,
  },
  {
    kind: 'table',
    label: 'varnox_bot_media',
    sql: `create table if not exists varnox_bot_media (
            id         bigserial primary key,
            sha256     text not null unique,
            mime       text not null,
            bytes      bytea not null,
            byte_size  integer not null,
            created_at timestamptz not null default now()
          )`,
  },
  {
    kind: 'column',
    label: 'varnox_bot_outbound.media_id',
    sql: `alter table varnox_bot_outbound add column if not exists media_id bigint`,
  },
  {
    kind: 'table',
    label: 'vx_call_participants',
    sql: `create table if not exists vx_call_participants (
            call_id    text   not null,
            user_id    text   not null,
            state      text   not null default 'invited',
            invited_at bigint not null,
            joined_at  bigint,
            left_at    bigint,
            primary key (call_id, user_id)
          )`,
  },
  {
    kind: 'index',
    label: 'vx_call_participants_user',
    sql: `create index if not exists vx_call_participants_user
            on vx_call_participants (user_id, call_id)`,
  },
  {
    // A new column rather than relaxing callee_id to nullable: this label is findable in
    // information_schema, so it is applied once and skipped afterwards. A step that only altered
    // an existing column could never be described as "present", and would re-run — and re-lock
    // the table — on every cold start.
    kind: 'column',
    label: 'vx_calls.is_group',
    sql: `alter table vx_calls add column if not exists is_group boolean not null default false`,
  },
  {
    kind: 'column',
    label: 'vx_call_signals.to_id',
    sql: `alter table vx_call_signals add column if not exists to_id text`,
  },
  {
    kind: 'table',
    label: 'vx_sms_outbox',
    sql: `create table if not exists vx_sms_outbox (
            id         bigserial primary key,
            to_phone   text    not null,
            body       text    not null,
            provider   text    not null,
            ok         boolean not null default true,
            error      text,
            created_at bigint  not null
          )`,
  },
  {
    kind: 'column',
    label: 'vx_users.deleted_at',
    sql: `alter table vx_users add column if not exists deleted_at bigint`,
  },
  {
    kind: 'index',
    label: 'vx_sms_outbox_phone',
    sql: `create index if not exists vx_sms_outbox_phone
            on vx_sms_outbox (to_phone, created_at desc)`,
  },
];

/** A request waits this long for reconciliation, then carries on without it. */
const SCHEMA_WAIT_MS = 4000;

export type MigrationReport = { ran: boolean; applied: string[]; failed: string | null };

let started: Promise<MigrationReport> | null = null;

/**
 * Runs at most once per process, and never holds a request longer than SCHEMA_WAIT_MS.
 * A failure is not cached, so a transient problem gets another chance on a later request.
 */
export function ensureSchema(): Promise<MigrationReport> {
  if (process.env.AUTO_MIGRATE === '0') {
    return Promise.resolve({ ran: false, applied: [], failed: null });
  }
  if (!started) started = run();

  const work = started;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[varnox] schema reconciliation still running after ${SCHEMA_WAIT_MS}ms — serving anyway`
      );
      // Let a later request try again rather than caching a stalled attempt forever.
      if (started === work) started = null;
      resolve({ ran: false, applied: [], failed: 'timed out' });
    }, SCHEMA_WAIT_MS);
    work.then((report) => {
      clearTimeout(timer);
      resolve(report);
    });
  });
}

/**
 * Errors that mean "someone already did this", which is a success for our purposes:
 * 42P07 duplicate_table, 42710 duplicate_object. Concurrent cold starts can race the same
 * statement, and `if not exists` does not make every one of them atomic.
 */
function alreadyDone(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P07' || code === '42710';
}

/** Everything that exists, in one round trip, so a healthy database costs one SELECT. */
async function existing(): Promise<Set<string>> {
  const rows = await q<{ kind: string; name: string }>(
    `select 'table' as kind, table_name as name from information_schema.tables
       where table_schema = 'public'
     union all
     select 'column', table_name || '.' || column_name from information_schema.columns
       where table_schema = 'public'
     union all
     select 'index', indexname from pg_indexes where schemaname = 'public'`
  );
  return new Set(rows.map((r) => `${r.kind}:${r.name}`));
}

async function run(): Promise<MigrationReport> {
  const applied: string[] = [];

  let present: Set<string>;
  try {
    present = await existing();
  } catch (err) {
    // No database at all: leave it to the individual request to report its own failure.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[varnox] schema reconciliation could not read the schema:', message);
    started = null;
    return { ran: false, applied, failed: message };
  }

  const missing = STEPS.filter((s) => !present.has(`${s.kind}:${s.label}`));
  if (!missing.length) return { ran: true, applied, failed: null };

  for (const step of missing) {
    try {
      await q(step.sql);
      applied.push(step.label);
    } catch (err) {
      if (alreadyDone(err)) continue;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[varnox] schema reconciliation failed at ${step.label}: ${message}`);
      const code = (err as { code?: string } | null)?.code;
      if (code === '23505') {
        console.error('[varnox]   duplicate values exist, so a unique index cannot be built');
      } else if (/permission denied/i.test(message)) {
        console.error('[varnox]   the database role may not be allowed to change the schema');
      }
      started = null;
      return { ran: false, applied, failed: message };
    }
  }

  console.log('[varnox] schema reconciliation applied:', applied.join(', '));
  return { ran: true, applied, failed: null };
}
