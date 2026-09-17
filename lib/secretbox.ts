import crypto from 'node:crypto';

/**
 * Authenticated encryption for the few secrets Varnox has to be able to read back.
 *
 * A Varnox bot token is hashed and never stored — see lib/bots-token.ts — because nothing ever
 * needs to see it again. A Telegram bot token is the opposite: Telegram has to be shown the
 * original value on every call, so it cannot be hashed, and the only question is what sits in
 * the column. Storing it in the clear means a dump of `vx_bots`, a stray `select *` in a log, or
 * one over-broad API projection hands over every bot the operator has. Sealing it means a stolen
 * copy of the table is not usable on its own.
 *
 * AES-256-GCM, chosen for one property that matters more here than the cipher: it is
 * *authenticated*. A tampered ciphertext fails to open rather than decrypting to a plausible-
 * looking value. With a plain stream cipher, an attacker who can edit the row could flip bits in
 * a token and the app would happily send the corrupted result to Telegram — or, worse, to
 * somewhere the attacker chose, if the plaintext were ever used to build a URL.
 *
 * The key is derived with HKDF from TELEGRAM_TOKEN_KEY, falling back to SESSION_SECRET so a
 * deployment that has not set the new variable still works. HKDF rather than using the string
 * directly: it turns a passphrase of unknown shape into exactly 32 uniform bytes, and the
 * distinct `info` string means the key here is not the same key that signs session cookies even
 * when both come from the same secret — a key reused across two purposes is a key whose
 * compromise is twice as bad as it needed to be.
 *
 * A consequence worth stating plainly: the sealed values cannot be read without the key they
 * were sealed with, so rotating SESSION_SECRET (or TELEGRAM_TOKEN_KEY) makes every stored
 * Telegram token unreadable. openSecret() returns null rather than throwing in that case, and
 * the UI turns that into "save the token again" instead of a 500 — which is the difference
 * between an operator knowing what to do and an operator filing a bug.
 */

const CIPHER = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM's native nonce size
const TAG_BYTES = 16;
const VERSION = 'v1';

/** Distinguishes this key from any other key derived from the same secret. */
const KEY_INFO = 'varnox/secretbox/v1';
const KEY_SALT = 'varnox/secretbox/salt/v1';

/** Raised when no key material is available at all, so the caller can explain the setup step. */
export class SecretKeyMissingError extends Error {
  constructor() {
    super(
      'TELEGRAM_TOKEN_KEY is not set, and neither is SESSION_SECRET, so bot credentials cannot be stored. ' +
        'Set one of them and restart the server.'
    );
    this.name = 'SecretKeyMissingError';
  }
}

/**
 * The configured key material, or a clear error.
 *
 * TELEGRAM_TOKEN_KEY first: a secret used for exactly one thing is the better arrangement, and
 * the fallback exists only so the feature does not require a second variable to work at all.
 */
function keyMaterial(): string {
  const dedicated = (process.env.TELEGRAM_TOKEN_KEY || '').trim();
  if (dedicated) return dedicated;
  const session = (process.env.SESSION_SECRET || '').trim();
  if (session) return session;
  throw new SecretKeyMissingError();
}

/** Whether sealing is possible at all, for a route that would rather report than throw. */
export function secretKeyAvailable(): boolean {
  try {
    keyMaterial();
    return true;
  } catch {
    return false;
  }
}

let cached: { material: string; key: Buffer } | null = null;

function key(): Buffer {
  const material = keyMaterial();
  // Cached per material, so rotating the variable takes effect without a restart and the
  // derivation is not repeated on every call.
  if (cached && cached.material === material) return cached.key;
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(material, 'utf8'),
    Buffer.from(KEY_SALT, 'utf8'),
    Buffer.from(KEY_INFO, 'utf8'),
    KEY_BYTES
  );
  const buffer = Buffer.from(derived);
  cached = { material, key: buffer };
  return buffer;
}

/**
 * Seal a secret. The output is self-describing — version, nonce, tag, ciphertext — so the
 * format can change later without guessing at what an old row holds.
 *
 * The nonce is fresh per call and random. GCM's catastrophic failure mode is reusing a nonce
 * with a key, which leaks the XOR of two plaintexts and destroys the authentication entirely,
 * so it is generated here rather than accepted from a caller: there is no way to call this
 * function and get a reused nonce.
 */
export function sealSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Whether a string looks like something this module produced, for a cheap pre-check. */
export function isSealed(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts[0] === VERSION && parts.every((p) => p.length > 0);
}

/**
 * Open a sealed secret, or return null.
 *
 * Null covers every way this can fail — nothing stored, a value from an older format, a
 * tampered row, a rotated key, a missing key — and they are deliberately not distinguished.
 * They are indistinguishable to the person who has to act on them anyway (the answer is "save
 * the Telegram token again"), and collapsing them means no branch here can forget one. It also
 * keeps this from becoming an oracle that tells an attacker holding a modified row whether the
 * change was the kind that breaks authentication.
 */
export function openSecret(sealed: string | null | undefined): string | null {
  if (typeof sealed !== 'string' || !sealed) return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, iv, tag, ciphertext] = parts;
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

/** Exported so a test can assert the format's dimensions rather than hard-coding them twice. */
export const SECRETBOX_SHAPE = { IV_BYTES, TAG_BYTES, KEY_BYTES } as const;
