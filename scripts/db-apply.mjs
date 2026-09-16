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

// Strip both comment styles, then split on statement boundaries. The schema has no functions or
// dollar-quoted bodies, so splitting on semicolons is unambiguous.
//
// The line-comment pass is not cosmetic. Stripping only /* */ left `--` notes intact, so a `;`
// typed inside one of them split the statement mid-comment and the remainder was sent to
// Postgres on its own — which fails with `syntax error at or near "a"`, a message that points
// at the schema rather than at this splitter. Two such semicolons had already crept into
// db/schema.sql unnoticed, because the app's own migrations (lib/migrate.ts) apply the same
// schema from an array of statements and never take this path. That is exactly why the bug
// survived: only `npm run db:apply` could see it.
//
// Neither `--` nor `/* */` appears inside a string literal in this schema, so a plain strip is
// safe here. If that ever stops being true, replace this with a real tokenizer.
const withoutComments = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)--[^\n]*/g, '$1');
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
