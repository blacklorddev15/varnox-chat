/**
 * Identifier helpers.
 *
 * These used to live in lib/blob.ts alongside the Vercel Blob storage code. They are
 * pure functions with no storage dependency, so they moved here when the datastore
 * became Postgres.
 */

export function rand(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + rand(7);
}
