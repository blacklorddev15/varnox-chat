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
const appealed = (ago: number) => suspensionState(NOW - 30 * DAY, NOW - ago, null, NOW);

describe('the suspension ladder', () => {
  it('is clear when it was never suspended', () => {
    expect(suspensionState(null, null, null, NOW)).toBe('clear');
  });

  it('stays banned when nobody appealed', () => {
    expect(suspensionState(NOW - DAY, null, null, NOW)).toBe('banned');
    expect(suspensionBlocksUse('banned')).toBe(true);
  });

  it('can still be read as banned after a year, because nothing moves on its own', () => {
    expect(suspensionState(NOW - 365 * DAY, null, null, NOW)).toBe('banned');
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
    expect(msUntilUsable(NOW - HOUR, null, NOW)).toBe(APPEAL_TEMPORARY_MS - HOUR);
    expect(msUntilUsable(NOW - 2 * DAY, null, NOW)).toBe(0);
    expect(msUntilUsable(null, null, NOW)).toBe(0);
  });
});

describe('a suspension with a date on it', () => {
  /** Suspended a day ago, with the end `untilOffset` from now; optionally appealed `reviewAgo` ago. */
  const dated = (untilOffset: number, reviewAgo: number | null = null) =>
    suspensionState(NOW - DAY, reviewAgo == null ? null : NOW - reviewAgo, NOW + untilOffset, NOW);

  it('blocks while the date is still ahead', () => {
    expect(dated(HOUR)).toBe('banned');
    expect(suspensionBlocksUse(dated(HOUR))).toBe(true);
  });

  it('releases at exactly the date, not a tick later', () => {
    // The same boundary rule the ladder uses: the moment promised is the moment it lifts.
    expect(dated(0)).toBe('expired');
    expect(suspensionBlocksUse(dated(0))).toBe(false);
  });

  it('stays released once the date has gone by', () => {
    expect(dated(-30 * DAY)).toBe('expired');
    expect(suspensionBlocksUse(dated(-30 * DAY))).toBe(false);
  });

  it('asks a released account to sign in again, as the appeal rungs do', () => {
    expect(suspensionNeedsFreshSignIn('expired')).toBe(true);
  });

  it('is not shortened by an appeal, however long ago it was asked', () => {
    // This is why the two mechanisms do not mix: an appeal is the way out of a suspension with
    // no end, and applying its five hours here would quietly erase a sentence that the owner
    // gave a length to.
    expect(dated(HOUR, 2 * DAY)).toBe('banned');
    expect(dated(HOUR, 30 * DAY)).toBe('banned');
    expect(dated(HOUR, APPEAL_CLEAR_MS)).toBe('banned');
  });

  it('counts down to its own date rather than to the appeal clock', () => {
    expect(msUntilUsable(NOW - 2 * DAY, NOW + 3 * HOUR, NOW)).toBe(3 * HOUR);
  });

  it('is still indefinite when it has neither a date nor an appeal', () => {
    expect(suspensionState(NOW - DAY, null, null, NOW)).toBe('banned');
  });

  it('reports no countdown for an indefinite suspension', () => {
    expect(msUntilUsable(null, null, NOW)).toBe(0);
  });
});
