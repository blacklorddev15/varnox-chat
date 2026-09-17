import { describe, expect, it } from 'vitest';
import {
  BOT_HANDLE_HINT,
  BOT_HANDLE_MAX,
  BOT_HANDLE_MIN,
  BOT_HANDLE_PATTERN,
  BOT_HANDLE_SUFFIX_HINT,
  describeHandleProblem,
  suggestHandle,
} from '../lib/bot-handle';

/**
 * The Varnox handle rules.
 *
 * This module is imported by both the route and the wizard, which is the reason it exists apart
 * from lib/bots.ts — so these tests cover what both sides will do with the same value, and the only
 * way the two can disagree is if this file is wrong.
 *
 * The rule with the most to get wrong is the required `-bot` / `_bot` ending, so most of what
 * follows is about that: which spellings count, which words merely end in those letters, and that a
 * suggested handle is always one the validator will accept.
 */

describe('BOT_HANDLE_PATTERN', () => {
  it('accepts the handles people actually write', () => {
    for (const ok of ['a-bot', 'ab-bot', 'support-bot', 'support_bot', 'my_bot_2-bot', 'a1-bot']) {
      expect(BOT_HANDLE_PATTERN.test(ok), ok).toBe(true);
    }
  });

  it('requires the separator, so a word that merely ends in those letters is refused', () => {
    // The separator is what makes the suffix readable as a suffix. Without this rule, "robot" and
    // "talbot" would be bot handles, and the requirement would mostly match ordinary words.
    for (const word of ['robot', 'talbot', 'abbot', 'supportbot']) {
      expect(BOT_HANDLE_PATTERN.test(word), word).toBe(false);
    }
  });

  it('accepts exactly the shortest and longest allowed', () => {
    // The shortest valid handle is "a-bot", which is where the minimum comes from rather than
    // being a number chosen separately from the pattern.
    const shortest = 'a-bot';
    expect(BOT_HANDLE_PATTERN.test(shortest)).toBe(true);
    expect(shortest).toHaveLength(BOT_HANDLE_MIN);

    const longest = 'a' + 'b'.repeat(26) + 'c' + '-bot';
    expect(longest).toHaveLength(BOT_HANDLE_MAX);
    expect(BOT_HANDLE_PATTERN.test(longest)).toBe(true);
  });

  it('refuses one character past the maximum', () => {
    const tooLong = 'a' + 'b'.repeat(27) + 'c' + '-bot';
    expect(tooLong).toHaveLength(BOT_HANDLE_MAX + 1);
    expect(BOT_HANDLE_PATTERN.test(tooLong)).toBe(false);
  });

  it('refuses a missing suffix, in either spelling', () => {
    expect(BOT_HANDLE_PATTERN.test('support')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support-')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support-bo')).toBe(false);
  });

  it('refuses a leading separator or a doubled one', () => {
    // "-bot" has no name in it, and "a--bot" reads as a typo next to an @.
    expect(BOT_HANDLE_PATTERN.test('-bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('_bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('a--bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('a-_bot')).toBe(false);
  });

  it('refuses capitals, spaces and punctuation', () => {
    expect(BOT_HANDLE_PATTERN.test('Support-bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support.bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('@support-bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support-bot!')).toBe(false);
  });

  it('is anchored, so a value merely containing a valid handle is refused', () => {
    // The bug an unanchored pattern would cause: /[a-z0-9]+/ matches "support bot" because it
    // contains one, and every check built on it would pass almost anything.
    expect(BOT_HANDLE_PATTERN.test('x support-bot x')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support-bot\n')).toBe(false);
    // "support-bot-bot" does end with the suffix, so it is a valid handle. Odd-looking, and the
    // rules do not forbid it — the suffix is a requirement, not a limit of one per name.
    expect(BOT_HANDLE_PATTERN.test('support-bot-bot')).toBe(true);
  });
});

describe('suggestHandle', () => {
  it('turns a display name into a handle the validator accepts', () => {
    expect(suggestHandle('Support Bot')).toBe('support-bot');
    expect(suggestHandle('Weather')).toBe('weather-bot');
    expect(suggestHandle('My Cool Bot')).toBe('my-cool-bot');
  });

  it('does not append a second suffix to a name that already has one', () => {
    // "support-bot" must not become "support-bot-bot".
    expect(suggestHandle('Support Bot')).toBe('support-bot');
    expect(suggestHandle('Support_Bot')).toBe('support-bot');
    expect(suggestHandle('support-bot')).toBe('support-bot');
  });

  it('produces something valid for short names, by building up rather than padding', () => {
    // 'A' cannot be padded to a handle, so the suffix does the work: 'a' + '-bot'.
    expect(suggestHandle('A')).toBe('a-bot');
    expect(BOT_HANDLE_PATTERN.test(suggestHandle('ab'))).toBe(true);
  });

  it('collapses runs of separators rather than repeating them', () => {
    expect(suggestHandle('Support   ---   Bot')).toBe('support-bot');
  });

  it('trims separators from both ends', () => {
    expect(suggestHandle('  Support Bot  ')).toBe('support-bot');
    expect(suggestHandle('!!!Bot!!!')).toBe('bot-bot');
  });

  it('truncates to the maximum, suffix included', () => {
    const suggested = suggestHandle('a'.repeat(60));
    expect(suggested).toHaveLength(BOT_HANDLE_MAX);
    expect(suggested.endsWith('-bot')).toBe(true);
    expect(BOT_HANDLE_PATTERN.test(suggested)).toBe(true);
  });

  it('yields a suggestion the validator accepts, or nothing at all', () => {
    /**
     * The contract that matters: a pre-filled field must never fail validation. An empty result is
     * allowed — a name of pure punctuation has nothing to build from — and is left empty rather
     * than invented, so the wizard shows the problem and the user fixes it.
     */
    const names = [
      'Support Bot', 'Bot_2', 'A', 'ab', 'Ünïcödé Böt', 'x'.repeat(80), '!!!Bot!!!',
      'Weather', 'my cool bot', 'bot', '1', 'z'.repeat(40),
    ];
    for (const name of names) {
      const suggested = suggestHandle(name);
      if (suggested === '') continue;
      expect(BOT_HANDLE_PATTERN.test(suggested), `${name} -> ${suggested}`).toBe(true);
      expect(describeHandleProblem(suggested), `${name} -> ${suggested}`).toBeNull();
    }
  });

  it('returns nothing for a name with nothing to build from', () => {
    expect(suggestHandle('')).toBe('');
    expect(suggestHandle('   ')).toBe('');
    expect(suggestHandle('!!!')).toBe('');
  });
});

describe('describeHandleProblem', () => {
  it('says nothing about a good handle', () => {
    expect(describeHandleProblem('support-bot')).toBeNull();
    expect(describeHandleProblem('support_bot')).toBeNull();
  });

  it('folds case rather than complaining about it', () => {
    expect(describeHandleProblem('Support-Bot')).toBeNull();
    expect(describeHandleProblem('  SupportBot-Bot  ')).toBeNull();
  });

  it('answers a missing suffix with the one sentence about the suffix', () => {
    // Anybody who typed "support" needs to hear one thing, and it is not the whole specification.
    expect(describeHandleProblem('support')).toBe(BOT_HANDLE_SUFFIX_HINT);
    expect(describeHandleProblem('weather')).toBe(BOT_HANDLE_SUFFIX_HINT);
  });

  it('calls a blank field required, not malformed', () => {
    expect(describeHandleProblem('')).toBe('A username is required.');
    expect(describeHandleProblem('   ')).toBe('A username is required.');
  });

  it('reports the length of a suffix-bearing handle that is still too short or too long', () => {
    // "-bot" already satisfies the suffix, so the useful message is about the length.
    expect(describeHandleProblem('-bot')).toContain('at least');
    expect(describeHandleProblem('a' + 'b'.repeat(28) + '-bot')).toContain('fewer');
  });

  it('falls back to the rules for anything else that does end in the suffix', () => {
    // These have the suffix and are still malformed, so the suffix message would be a lie and the
    // full rules are what is needed.
    expect(describeHandleProblem('a--bot')).toBe(BOT_HANDLE_HINT);
    expect(describeHandleProblem('a-_bot')).toBe(BOT_HANDLE_HINT);
  });

  it('answers a missing suffix with the suffix message, whatever else is also wrong', () => {
    // One fix at a time, and the suffix is the one to state: "support.bot" has an illegal
    // character too, but the reason it was rejected is that it does not end in -bot.
    expect(describeHandleProblem('support.bot')).toBe(BOT_HANDLE_SUFFIX_HINT);
    expect(describeHandleProblem('support bot')).toBe(BOT_HANDLE_SUFFIX_HINT);
    expect(describeHandleProblem('Support')).toBe(BOT_HANDLE_SUFFIX_HINT);
  });

  it('keeps the hint and the bounds in step with the pattern', () => {
    expect(BOT_HANDLE_HINT).toContain(String(BOT_HANDLE_MIN));
    expect(BOT_HANDLE_HINT).toContain(String(BOT_HANDLE_MAX));
    expect(BOT_HANDLE_HINT).toContain('-bot or _bot');
    expect(BOT_HANDLE_SUFFIX_HINT).toContain('-bot or _bot');
  });
});
