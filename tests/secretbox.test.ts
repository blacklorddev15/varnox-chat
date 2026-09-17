import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SECRETBOX_SHAPE,
  SecretKeyMissingError,
  isSealed,
  openSecret,
  sealSecret,
  secretKeyAvailable,
} from '../lib/secretbox';

/**
 * The sealed at-rest encryption used for the Telegram bot token.
 *
 * The property being tested is not "it round-trips" — that would pass for a base64 encoder, which
 * would be worthless. It is that only the holder of the key can open it, and that a modified value
 * fails rather than decrypting to something plausible.
 */

const SAVED = { key: process.env.TELEGRAM_TOKEN_KEY, session: process.env.SESSION_SECRET };

/** Change the first character of a base64url string, which always changes the decoded bytes. */
function flipFirst(value: string): string {
  return (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
}

beforeEach(() => {
  process.env.TELEGRAM_TOKEN_KEY = 'a-test-key-that-is-long-enough-to-derive-from';
  delete process.env.SESSION_SECRET;
});

afterEach(() => {
  if (SAVED.key === undefined) delete process.env.TELEGRAM_TOKEN_KEY;
  else process.env.TELEGRAM_TOKEN_KEY = SAVED.key;

  if (SAVED.session === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = SAVED.session;
});

describe('sealSecret / openSecret', () => {
  it('round-trips a Telegram bot token', () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    expect(openSecret(sealSecret(token))).toBe(token);
  });

  it('round-trips an empty string without confusing it with "no value"', () => {
    expect(openSecret(sealSecret(''))).toBe('');
  });

  it('does not put the plaintext in the sealed value', () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    const sealed = sealSecret(token);
    expect(sealed).not.toContain(token);
    expect(sealed).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
  });

  it('uses a fresh nonce, so two seals of one value differ', () => {
    // GCM's failure mode when a nonce repeats is leaking the XOR of two plaintexts and losing
    // authentication outright, so identical output for identical input would be the bug.
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    expect(sealSecret(token)).not.toBe(sealSecret(token));
  });

  it('is self-describing, so the format can change later', () => {
    const sealed = sealSecret('x');
    const parts = sealed.split('.');
    expect(parts[0]).toBe('v1');
    expect(parts).toHaveLength(4);
    expect(isSealed(sealed)).toBe(true);
  });

  it('writes the documented IV and tag sizes', () => {
    const [, iv, tag] = sealSecret('x').split('.');
    expect(Buffer.from(iv, 'base64url')).toHaveLength(SECRETBOX_SHAPE.IV_BYTES);
    expect(Buffer.from(tag, 'base64url')).toHaveLength(SECRETBOX_SHAPE.TAG_BYTES);
  });
});

describe('openSecret refuses what it should', () => {
  it('returns null for nothing stored, rather than throwing', () => {
    expect(openSecret(null)).toBeNull();
    expect(openSecret(undefined)).toBeNull();
    expect(openSecret('')).toBeNull();
  });

  it('returns null for a value that is not in the sealed format', () => {
    expect(openSecret('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBeNull();
    expect(openSecret('v2.a.b.c')).toBeNull();
    expect(openSecret('v1.a.b')).toBeNull();
  });

  it('returns null when the ciphertext has been edited', () => {
    // The whole reason for GCM rather than a plain stream cipher: an attacker with write access
    // to the row must not be able to steer what gets sent to Telegram.
    // The *first* character, not the last. A base64url group carries 6 bits per character, and
    // the final character of a group whose length is not a multiple of three carries only the
    // leftover bits — so some edits to the last character decode to the identical bytes and the
    // value opens perfectly well. Flipping the first character always changes the first byte.
    const sealed = sealSecret('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    const [version, iv, tag, ciphertext] = sealed.split('.');
    const flipped = flipFirst(ciphertext);
    expect(openSecret([version, iv, tag, flipped].join('.'))).toBeNull();
  });

  it('returns null when the authentication tag has been edited', () => {
    const sealed = sealSecret('a real token');
    const [version, iv, tag, ciphertext] = sealed.split('.');
    expect(openSecret([version, iv, flipFirst(tag), ciphertext].join('.'))).toBeNull();
  });

  it('returns null when the nonce has been edited', () => {
    const sealed = sealSecret('a real token');
    const [version, iv, tag, ciphertext] = sealed.split('.');
    expect(openSecret([version, flipFirst(iv), tag, ciphertext].join('.'))).toBeNull();
  });

  it('returns null after the key changes, instead of throwing', () => {
    /**
     * Rotating SESSION_SECRET or TELEGRAM_TOKEN_KEY makes every stored Telegram token
     * unreadable. That is a real operational consequence, and the test pins the behaviour the UI
     * depends on: null, so the route can answer 409 with "save the token again", rather than an
     * exception that reaches the browser as a 500 telling nobody anything.
     */
    const sealed = sealSecret('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    process.env.TELEGRAM_TOKEN_KEY = 'a completely different key';
    expect(openSecret(sealed)).toBeNull();
  });
});

describe('key configuration', () => {
  it('falls back to SESSION_SECRET when no dedicated key is set', () => {
    delete process.env.TELEGRAM_TOKEN_KEY;
    process.env.SESSION_SECRET = 'the session secret';
    expect(secretKeyAvailable()).toBe(true);
    expect(openSecret(sealSecret('x'))).toBe('x');
  });

  it('treats the dedicated key and the session secret as interchangeable when they hold the same string', () => {
    /**
     * The contract the fallback makes: which variable the material came from is invisible, and
     * the two are one key when they hold one value. Worth pinning because the consequence is the
     * other way round too — changing *either* value to something new makes every stored token
     * unreadable, which is what the rotation test above and the 409 in the test route are for.
     *
     * (That the same string would produce the *same* key here and a different one in the session
     * signer is HKDF's `info` string doing its job; it is not observable from outside this
     * module, so it is not asserted.)
     */
    delete process.env.TELEGRAM_TOKEN_KEY;
    process.env.SESSION_SECRET = 'a shared secret';
    const viaSession = sealSecret('x');

    delete process.env.SESSION_SECRET;
    process.env.TELEGRAM_TOKEN_KEY = 'a shared secret';
    expect(openSecret(viaSession)).toBe('x');
  });

  it('refuses to seal anything when no key is configured at all', () => {
    delete process.env.TELEGRAM_TOKEN_KEY;
    delete process.env.SESSION_SECRET;
    expect(secretKeyAvailable()).toBe(false);
    expect(() => sealSecret('x')).toThrow(SecretKeyMissingError);
  });
});
