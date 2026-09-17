import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOT_TOKEN_PREFIX,
  botTokenMatches,
  hashBotToken,
  looksLikeBotToken,
  looksLikeTelegramToken,
  newBotToken,
  redact,
} from '../lib/bots-token';

/**
 * Token generation, and the rules about the token that are worth proving.
 *
 * No database and no request: every function here is pure, which is exactly why the module was
 * separated from the one that touches rows. A security property that can only be checked through
 * three layers of machinery is a property that stops being checked.
 */

const TOKEN_CHARS = 43; // 32 bytes in base64url, unpadded

describe('newBotToken', () => {
  it('mints a token with the documented prefix and length', () => {
    const token = newBotToken();
    expect(token.startsWith(BOT_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBe(BOT_TOKEN_PREFIX.length + TOKEN_CHARS);
  });

  it('uses only the base64url alphabet, so it survives a URL and a header unchanged', () => {
    for (let i = 0; i < 200; i++) {
      const secret = newBotToken().slice(BOT_TOKEN_PREFIX.length);
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat itself', () => {
    // 256-bit secrets, so a collision here would mean the generator is not generating. Ten
    // thousand draws is far past the point where a weak source or a fixed seed would show up as
    // a repeat long before entropy ran out.
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newBotToken());
    expect(seen.size).toBe(10_000);
  });

  it('draws from the CSPRNG, as a property of the source itself', () => {
    /**
     * This is a source-level assertion, which is unusual, and the reason it earns its place is
     * that the property cannot be observed from the output. Math.random and crypto.randomBytes
     * both produce 10,000 distinct 43-character strings; what separates them is the size of the
     * internal state an observer can recover, and no input/output test can see that.
     *
     * What can be checked is the thing that would actually go wrong — somebody "simplifying" the
     * generator to Math.random, which reads as a harmless tidy-up and quietly turns every token
     * into a guessable number. That edit is caught here.
     */
    const source = readFileSync(fileURLToPath(new URL('../lib/bots-token.ts', import.meta.url)), 'utf8');
    expect(source).toContain('crypto.randomBytes');
    // With the call parens, so the assertion is about code and not about the doc comment above
    // that explains why Math.random is not used.
    expect(source).not.toContain('Math.random(');
  });
});

describe('hashBotToken', () => {
  it('is a 64-character hex digest', () => {
    expect(hashBotToken(newBotToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const token = newBotToken();
    expect(hashBotToken(token)).toBe(hashBotToken(token));
  });

  it('differs for two different tokens', () => {
    expect(hashBotToken(newBotToken())).not.toBe(hashBotToken(newBotToken()));
  });

  it('never returns the token itself', () => {
    const token = newBotToken();
    expect(hashBotToken(token)).not.toBe(token);
    expect(hashBotToken(token)).not.toContain(token.slice(BOT_TOKEN_PREFIX.length));
  });
});

describe('botTokenMatches', () => {
  it('accepts the token a hash was made from', () => {
    const token = newBotToken();
    expect(botTokenMatches(token, hashBotToken(token))).toBe(true);
  });

  it('refuses a different token', () => {
    expect(botTokenMatches(newBotToken(), hashBotToken(newBotToken()))).toBe(false);
  });

  it('refuses the stored hash presented as a token', () => {
    /**
     * The mistake this guards against is a caller passing the row's `token_hash` where a
     * presented token belongs — easy to do, since both are strings and both come from the same
     * place. If the hash itself were accepted, a database leak would be a set of working
     * credentials rather than a set of useless digests.
     */
    const token = newBotToken();
    const hash = hashBotToken(token);
    expect(botTokenMatches(hash, hash)).toBe(false);
  });

  it('refuses a token that differs in one character', () => {
    const token = newBotToken();
    const hash = hashBotToken(token);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(botTokenMatches(flipped, hash)).toBe(false);
  });

  it('refuses anything that is not two strings', () => {
    const hash = hashBotToken(newBotToken());
    expect(botTokenMatches(undefined, hash)).toBe(false);
    expect(botTokenMatches(null, hash)).toBe(false);
    expect(botTokenMatches(42, hash)).toBe(false);
    expect(botTokenMatches({}, hash)).toBe(false);
    expect(botTokenMatches('', hash)).toBe(false);
    expect(botTokenMatches(newBotToken(), null)).toBe(false);
    expect(botTokenMatches(newBotToken(), '')).toBe(false);
  });
});

describe('looksLikeBotToken', () => {
  it('accepts a minted token', () => {
    expect(looksLikeBotToken(newBotToken())).toBe(true);
  });

  it('refuses the wrong prefix', () => {
    expect(looksLikeBotToken('vz_' + 'a'.repeat(TOKEN_CHARS))).toBe(false);
  });

  it('refuses the wrong length in either direction', () => {
    expect(looksLikeBotToken(BOT_TOKEN_PREFIX + 'a'.repeat(TOKEN_CHARS - 1))).toBe(false);
    expect(looksLikeBotToken(BOT_TOKEN_PREFIX + 'a'.repeat(TOKEN_CHARS + 1))).toBe(false);
    expect(looksLikeBotToken(BOT_TOKEN_PREFIX)).toBe(false);
  });

  it('refuses characters outside the alphabet, including a trailing newline', () => {
    expect(looksLikeBotToken(BOT_TOKEN_PREFIX + 'a'.repeat(TOKEN_CHARS - 1) + '!')).toBe(false);
    expect(looksLikeBotToken(newBotToken() + '\n')).toBe(false);
    expect(looksLikeBotToken(' ' + newBotToken())).toBe(false);
  });

  it('refuses non-strings', () => {
    expect(looksLikeBotToken(undefined)).toBe(false);
    expect(looksLikeBotToken(null)).toBe(false);
    expect(looksLikeBotToken(12345)).toBe(false);
    expect(looksLikeBotToken(['vx_token'])).toBe(false);
  });
});

describe('looksLikeTelegramToken', () => {
  it('accepts the shape Telegram issues', () => {
    expect(looksLikeTelegramToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true);
    expect(looksLikeTelegramToken('8123456:AAF-9_abcDEF1234567890abcdefghijKl')).toBe(true);
  });

  it('refuses a string with no bot id, or no colon', () => {
    expect(looksLikeTelegramToken('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false);
    expect(looksLikeTelegramToken('123456789AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false);
    expect(looksLikeTelegramToken('not-a-token')).toBe(false);
    expect(looksLikeTelegramToken('')).toBe(false);
  });

  it('refuses a secret that is too short to be one', () => {
    expect(looksLikeTelegramToken('123456789:short')).toBe(false);
  });

  it('refuses a Varnox token', () => {
    expect(looksLikeTelegramToken(newBotToken())).toBe(false);
  });

  it('refuses non-strings', () => {
    expect(looksLikeTelegramToken(undefined)).toBe(false);
    expect(looksLikeTelegramToken(123456789)).toBe(false);
  });
});

describe('redact', () => {
  it('replaces every occurrence of a secret', () => {
    const secret = 'vx_supersecretvalue';
    expect(redact(`a ${secret} b ${secret} c`, [secret])).toBe('a [redacted] b [redacted] c');
  });

  it('handles the token that appears in a URL', () => {
    const token = newBotToken();
    const message = `request to https://bot.internal/bot${token}/getMe failed`;
    const out = redact(message, [token]);
    expect(out).not.toContain(token);
    expect(out).toContain('[redacted]');
  });

  it('replaces the longest secret first, leaving no fragment behind', () => {
    // 'abcdef' contains 'abc'. Replacing the short one first would leave 'def' visible.
    expect(redact('abcdef', ['abc', 'abcdef'])).toBe('[redacted]');
  });

  it('ignores empty and missing secrets, which would otherwise mark every character', () => {
    expect(redact('hello', ['', null, undefined])).toBe('hello');
    expect(redact('', [])).toBe('');
  });
});
