import { describe, expect, it } from 'vitest';
import {
  BOT_HANDLE_HINT,
  BOT_HANDLE_MAX,
  BOT_HANDLE_MIN,
  BOT_HANDLE_PATTERN,
  describeHandleProblem,
  suggestHandle,
} from '../lib/bot-handle';

/**
 * The Varnox handle rules.
 *
 * This module is imported by both the route and the wizard, which is the reason it exists apart
 * from lib/bots.ts — so these tests cover what both sides will do with the same value, and the
 * only way the two can disagree is if this file is wrong.
 */

describe('BOT_HANDLE_PATTERN', () => {
  it('accepts the handles people actually write', () => {
    for (const ok of ['abc', 'support-bot', 'a1b', 'my_bot_2', 'bot-2', 'a-b-c-d']) {
      expect(BOT_HANDLE_PATTERN.test(ok), ok).toBe(true);
    }
  });

  it('accepts exactly the shortest and longest allowed', () => {
    expect(BOT_HANDLE_PATTERN.test('a'.repeat(BOT_HANDLE_MIN))).toBe(true);
    expect(BOT_HANDLE_PATTERN.test('a'.repeat(BOT_HANDLE_MAX))).toBe(true);
  });

  it('refuses one character past either bound', () => {
    expect(BOT_HANDLE_PATTERN.test('a'.repeat(BOT_HANDLE_MIN - 1))).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('a'.repeat(BOT_HANDLE_MAX + 1))).toBe(false);
  });

  it('refuses a leading or trailing separator', () => {
    // A handle is written next to an @ and read as a name, so either of these reads as a typo.
    expect(BOT_HANDLE_PATTERN.test('-abc')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('abc-')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('_abc')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('abc_')).toBe(false);
  });

  it('refuses capitals, spaces and punctuation', () => {
    expect(BOT_HANDLE_PATTERN.test('SupportBot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support.bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support@bot')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('@supportbot')).toBe(false);
  });

  it('is anchored, so a value merely containing a valid handle is refused', () => {
    // The bug an unanchored pattern would cause: /[a-z0-9]+/ matches "support bot" because it
    // contains one, and every check built on it would pass almost anything.
    expect(BOT_HANDLE_PATTERN.test('support bot!')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('x support-bot x')).toBe(false);
    expect(BOT_HANDLE_PATTERN.test('support-bot\n')).toBe(false);
  });
});

describe('suggestHandle', () => {
  it('turns a display name into a first guess', () => {
    expect(suggestHandle('Support Bot')).toBe('support-bot');
    expect(suggestHandle('Support  Bot!')).toBe('support-bot');
    expect(suggestHandle('My Cool Bot')).toBe('my-cool-bot');
  });

  it('collapses runs of separators rather than repeating them', () => {
    expect(suggestHandle('Support   ---   Bot')).toBe('support-bot');
  });

  it('trims separators from both ends', () => {
    expect(suggestHandle('  Support Bot  ')).toBe('support-bot');
    expect(suggestHandle('!!!Bot!!!')).toBe('bot');
  });

  it('truncates to the maximum', () => {
    const suggested = suggestHandle('a'.repeat(60));
    expect(suggested.length).toBeLessThanOrEqual(BOT_HANDLE_MAX);
    expect(BOT_HANDLE_PATTERN.test(suggested)).toBe(true);
  });

  it('produces a valid handle for every name long enough to yield one', () => {
    for (const name of ['Support Bot', 'Bot_2', 'Ünïcödé Böt', 'x'.repeat(80), '!!!Bot!!!']) {
      const suggested = suggestHandle(name);
      expect(suggested.length, name).toBeLessThanOrEqual(BOT_HANDLE_MAX);
      expect(BOT_HANDLE_PATTERN.test(suggested), `${name} -> ${suggested}`).toBe(true);
    }
  });

  it('leaves a name too short to make a handle from short, rather than padding it', () => {
    // 'A' and 'ab' cannot yield a three-character handle, and inventing characters to reach the
    // minimum would hand somebody a name they did not choose. The suggestion is left short so the
    // wizard can show the problem and the user can fix it — which is the point of the next test.
    for (const name of ['A', 'ab']) {
      const suggested = suggestHandle(name);
      expect(suggested.length).toBeLessThan(BOT_HANDLE_MIN);
      expect(describeHandleProblem(suggested)).toContain('at least');
    }
  });

  it('can return something too short for the user to fix, rather than inventing characters', () => {
    expect(suggestHandle('ab')).toBe('ab');
    expect(describeHandleProblem(suggestHandle('ab'))).toContain('at least');
  });
});

describe('describeHandleProblem', () => {
  it('says nothing about a good handle', () => {
    expect(describeHandleProblem('support-bot')).toBeNull();
  });

  it('folds case rather than complaining about it', () => {
    // The wizard shows this note; if it objected to capitals the user would be told to fix
    // something the server was going to accept anyway.
    expect(describeHandleProblem('Support-Bot')).toBeNull();
    expect(describeHandleProblem('  SupportBot  ')).toBeNull();
  });

  it('calls a blank field required, not malformed', () => {
    expect(describeHandleProblem('')).toBe('A username is required.');
    expect(describeHandleProblem('   ')).toBe('A username is required.');
  });

  it('reports a length problem before a pattern problem', () => {
    // "-" is both too short and perfectly good punctuation; the useful message is the length.
    expect(describeHandleProblem('ab')).toContain('at least');
    expect(describeHandleProblem('a'.repeat(BOT_HANDLE_MAX + 1))).toContain('fewer');
  });

  it('falls back to the rules for anything else', () => {
    expect(describeHandleProblem('-abc')).toBe(BOT_HANDLE_HINT);
    expect(describeHandleProblem('support.bot')).toBe(BOT_HANDLE_HINT);
  });

  it('keeps the hint and the bounds in step with the pattern', () => {
    expect(BOT_HANDLE_HINT).toContain(String(BOT_HANDLE_MIN));
    expect(BOT_HANDLE_HINT).toContain(String(BOT_HANDLE_MAX));
  });
});
