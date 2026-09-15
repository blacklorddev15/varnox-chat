import { Pool, types } from 'pg';

/**
 * Postgres access.
 *
 * Runs against Neon. The connection string is a pooled endpoint, which is what a
 * serverless deployment wants: many short-lived function instances, few real
 * connections.
 */

// node-postgres returns int8 as a string to protect against precision loss. Every int8
// column in this schema holds epoch milliseconds (~1.7e12), far inside the safe integer
// range, so parsing them to numbers is correct and keeps arithmetic like `b.at - a.at`
// from silently producing NaN.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

/**
 * Neon's connection string can carry `channel_binding=require`, which node-postgres
 * does not understand. Strip it rather than fail to connect.
 */
function connectionString(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch {
    return raw;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __varnoxPool: Pool | undefined;
}

export function pool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');

  if (!globalThis.__varnoxPool) {
    const cleaned = connectionString(raw);
    const isLocal = /localhost|127\.0\.0\.1/.test(cleaned);
    // Managed Postgres requires TLS. Set explicitly rather than relying on sslmode in the
    // URL, so a connection string without it cannot silently fall back to plaintext.
    // Neon's certificate chains to a publicly trusted CA, so full verification works; set
    // DATABASE_SSL_NO_VERIFY=1 only if you are pointed at a server with a self-signed cert.
    const noVerify = process.env.DATABASE_SSL_NO_VERIFY === '1';
    globalThis.__varnoxPool = new Pool({
      connectionString: cleaned,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ...(isLocal ? {} : { ssl: { rejectUnauthorized: !noVerify } }),
    });
  }
  return globalThis.__varnoxPool;
}

/** Run a query and return just the rows. */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool().query(text, params as never[]);
  return result.rows as T[];
}
