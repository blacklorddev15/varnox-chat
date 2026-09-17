import { describe, expect, it } from 'vitest';
import {
  APPEAL_CLEAR_MS,
  APPEAL_TEMPORARY_MS,
  msUntilUsable,
  suspensionBlocksUse,
  suspensionNeedsFreshSignIn,
  suspensionState,
} from '@/lib/suspension';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** An account suspended a month ago, appealing `ago` ms before now. */
const appealed = (ago: number) => suspensionState(NOW - 30 * DAY, NOW - ago, NOW);

describe('the suspension ladder', () => {
  it('is clear when it was never suspended', () => {
    expect(suspensionState(null, null, NOW)).toBe('clear');
  });

  it('stays banned when nobody appealed', () => {
    expect(suspensionState(NOW - DAY, null, NOW)).toBe('banned');
    expect(suspensionBlocksUse('banned')).toBe(true);
  });

  it('can still be read as banned after a year, because nothing moves on its own', () => {
    expect(suspensionState(NOW - 365 * DAY, null, NOW)).toBe('banned');
  });

  it('waits while the five hours run', () => {
    expect(appealed(HOUR)).toBe('waiting');
    expect(appealed(APPEAL_TEMPORARY_MS - 1)).toBe('waiting');
    expect(suspensionBlocksUse('waiting')).toBe(true);
  });

  it('becomes usable at exactly five hours, which is the promise the screen made', () => {
    expect(appealed(APPEAL_TEMPORARY_MS)).toBe('temporary');
    expect(suspensionBlocksUse('temporary')).toBe(false);
  });

  it('stays temporary through the week', () => {
    expect(appealed(6 * DAY)).toBe('temporary');
    expect(appealed(APPEAL_CLEAR_MS - 1)).toBe('temporary');
  });

  it('drops the suspension at exactly a week', () => {
    expect(appealed(APPEAL_CLEAR_MS)).toBe('restored');
  });

  it('asks a coming-back account to sign in again, and a clear one not to', () => {
    expect(suspensionNeedsFreshSignIn('temporary')).toBe(true);
    expect(suspensionNeedsFreshSignIn('restored')).toBe(true);
    expect(suspensionNeedsFreshSignIn('banned')).toBe(false);
    expect(suspensionNeedsFreshSignIn('clear')).toBe(false);
  });

  it('counts down to the moment it becomes usable', () => {
    expect(msUntilUsable(NOW - HOUR, NOW)).toBe(APPEAL_TEMPORARY_MS - HOUR);
    expect(msUntilUsable(NOW - 2 * DAY, NOW)).toBe(0);
    expect(msUntilUsable(null, NOW)).toBe(0);
  });
});
