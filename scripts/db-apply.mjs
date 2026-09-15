#!/usr/bin/env node
/**
 * Apply db/schema.sql.
 *
 * Every statement is IF NOT EXISTS, so this is safe to re-run and will not drop anything.
 * Run with:  npm run db:apply
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// node-postgres does not understand Neon's channel_binding parameter.
const url = new URL(raw);
url.searchParams.delete('channel_binding');

const sql = await readFile(join(root, 'db', 'schema.sql'), 'utf8');

// Strip /* */ comments, then split on statement boundaries. The schema has no functions or
// dollar-quoted bodies, so splitting on semicolons is unambiguous.
const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
const statements = withoutComments
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: /localhost|127\.0\.0\.1/.test(url.hostname) ? undefined : { rejectUnauthorized: false },
});

await client.connect();
let applied = 0;
for (const statement of statements) {
  await client.query(statement);
  applied += 1;
}

const tables = await client.query(
  `select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`
);
console.log(`Applied ${applied} statements.`);
console.log(`Tables (${tables.rowCount}): ${tables.rows.map((r) => r.table_name).join(', ')}`);
await client.end();
