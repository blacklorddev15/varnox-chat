import { ensureSchema } from '@/lib/migrate';
import { q } from '@/lib/pg';

export const dynamic = 'force-dynamic';

/**
 * Deployment health: is the database the shape this code expects?
 *
 * It exists because a deploy and a migration can get out of step. The code ships, the
 * schema change does not run, and the symptom is a handful of unrelated-looking failures —
 * a display picture that will not save, a signup that errors, an email login that 500s.
 * Asking the database directly turns that hunt into a one-line answer.
 *
 * The missing-object names are safe to return publicly: this repository is public, so the
 * schema is not a secret. Nothing here exposes data or credentials.
 */
const REQUIRED_TABLES = [
  'vx_users',
  'vx_convs',
  'vx_messages',
  'vx_media',
  'vx_otp',
  'vx_otp_rate',
  'vx_msg_views',
  'vx_calls',
  'vx_call_signals',
  // Where call membership lives. Without it a group call cannot be joined by anybody, and the
  // one-to-one screens still work — so a missing table here would look like "group calls are
  // just broken" rather than like a schema problem.
  'vx_call_participants',
  // The pairing bridge's tables are not in the vx_ namespace, because an external bot
  // polls them by name and the names come from its source rather than from here.
  'varnox_pairing_requests',
  'varnox_sessions',
  // The command bridge's tables, for the same reason: the bot's helper names them, and a
  // missing one here would fail silently — the app would queue messages into a table nobody
  // reads and the thread would simply never answer.
  'varnox_bot_inbound',
  'varnox_bot_outbound',
];
const REQUIRED_COLUMNS: { table: string; column: string }[] = [
  { table: 'vx_users', column: 'email' },
  { table: 'vx_media', column: 'once' },
  { table: 'vx_messages', column: 'once' },
  { table: 'vx_messages', column: 'payload' },
];

export async function GET() {
  // Let the app close the gap first, then report what the database actually looks like
  // afterwards — so a 200 here means "aligned", not "aligned once someone runs SQL".
  const migration = await ensureSchema();

  try {
    const tables = await q<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [REQUIRED_TABLES]
    );
    const presentTables = new Set(tables.map((r) => r.table_name));
    const missingTables = REQUIRED_TABLES.filter((t) => !presentTables.has(t));

    const columns = await q<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
          and column_name = any($2::text[])`,
      [REQUIRED_COLUMNS.map((c) => c.table), REQUIRED_COLUMNS.map((c) => c.column)]
    );
    const presentColumns = new Set(columns.map((r) => `${r.table_name}.${r.column_name}`));
    const missingColumns = REQUIRED_COLUMNS.map((c) => `${c.table}.${c.column}`).filter(
      (key) => !presentColumns.has(key)
    );

    const missing = [...missingTables, ...missingColumns];
    const ready = missing.length === 0;

    return Response.json(
      ready
        ? {
            ok: true,
            schema: 'up to date',
            ...(migration.applied.length ? { autoApplied: migration.applied } : {}),
            ...(migration.failed ? { autoMigrateFailed: migration.failed } : {}),
          }
        : {
            ok: false,
            missing,
            autoMigrateFailed: migration.failed ?? undefined,
            fix: 'Run the migration: npm run db:apply — or paste db/schema.sql into your database console.',
          },
      { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    // "Cannot connect" is a different problem from "missing column", and saying which one
    // it is stops someone chasing the wrong cause.
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'database unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
