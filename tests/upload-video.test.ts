import { describe, expect, it } from 'vitest';
import { looksLikeVideoContainer } from '../app/api/upload/route';

/**
 * Video container detection.
 *
 * The offsets are the whole point of this function and they are exactly the kind of thing that
 * looks right and is not: `ftyp` sits at offset 4 because the first four bytes are the box
 * length, while EBML and RIFF start at zero but RIFF needs a second signature eight bytes in.
 * A wrong offset here does not throw — it silently files every video as a document, which then
 * renders as a download link instead of something that plays.
 *
 * The last two cases matter as much as the first three: this function has to stay narrow, since
 * its whole purpose is to be paired with the audio sniff, which claims the same containers.
 */

/** A buffer whose bytes start with the given signature. */
function bytes(...head: number[]): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set(head, 0);
  return buf;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe('looksLikeVideoContainer', () => {
  it('accepts an mp4, where ftyp sits at offset 4', () => {
    // 4-byte box length, then "ftyp", then the brand.
    expect(looksLikeVideoContainer(bytes(0x00, 0x00, 0x00, 0x18, ...ascii('ftypisom')))).toBe(true);
  });

  it('accepts a QuickTime mov, which uses the same ftyp box', () => {
    expect(looksLikeVideoContainer(bytes(0x00, 0x00, 0x00, 0x14, ...ascii('ftypqt  ')))).toBe(true);
  });

  it('accepts a webm or mkv, which are EBML', () => {
    expect(looksLikeVideoContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00))).toBe(true);
  });

  it('accepts an AVI, which needs RIFF and then AVI at offset 8', () => {
    expect(looksLikeVideoContainer(bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('AVI ')))).toBe(true);
  });

  it('rejects a JPEG, so a photo cannot be filed as video', () => {
    expect(looksLikeVideoContainer(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(false);
  });

  it('rejects a PNG', () => {
    expect(looksLikeVideoContainer(bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
  });

  it('rejects a RIFF file that is not AVI, such as a WAV or WEBP', () => {
    // RIFF alone is not enough — WAVE and WEBP share it with AVI.
    expect(looksLikeVideoContainer(bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WAVE')))).toBe(
      false
    );
    expect(looksLikeVideoContainer(bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')))).toBe(
      false
    );
  });

  it('rejects empty and all-zero input', () => {
    expect(looksLikeVideoContainer(new Uint8Array(0))).toBe(false);
    expect(looksLikeVideoContainer(new Uint8Array(16))).toBe(false);
  });
});
