import { afterEach, describe, expect, it } from 'vitest';
import { verificationMessage } from '@/lib/mail';
import { maskPhone } from '@/lib/phone';

/**
 * The mask exists so a message can name which number it is for without the whole number going to a
 * mailbox. The case worth guarding is the country code: taking two digits on faith renders a
 * Kenyan +254 as +25 47…, which is not a less precise mask, it is the wrong country.
 */
describe('naming a number back to its owner', () => {
  it('keeps the country and the last three digits', () => {
    expect(maskPhone('+254712345678', '254')).toBe('+254 ••••••678');
  });

  it('does not invent a country when none was given', () => {
    const masked = maskPhone('+254712345678');
    expect(masked).not.toContain('+25 ');
    expect(masked.endsWith('678')).toBe(true);
  });

  it('handles a one-digit country code', () => {
    // 4155552671 is ten digits, so seven are hidden and the last three are kept.
    expect(maskPhone('+14155552671', '1')).toBe('+1 •••••••671');
  });

  it('handles a three-digit code that a two-digit guess would break', () => {
    expect(maskPhone('+8801712345678', '880')).toBe('+880 •••••••678');
  });

  it('refuses a string too short to be a number rather than masking nonsense', () => {
    expect(maskPhone('12345', '1')).toBe('');
    expect(maskPhone(null, '1')).toBe('');
  });

  it('ignores a dial code the number does not actually start with', () => {
    expect(maskPhone('+254712345678', '44').startsWith('+44')).toBe(false);
  });
});

describe('the number inside the copy', () => {
  const saved = process.env.MAIL_BODY;
  afterEach(() => {
    if (saved === undefined) delete process.env.MAIL_BODY;
    else process.env.MAIL_BODY = saved;
  });

  it('is substituted when known', () => {
    process.env.MAIL_BODY = 'Your code is {code} for {number}.';
    expect(verificationMessage('123456', 10, '+254 ••••••678')).toBe(
      'Your code is 123456 for +254 ••••••678.'
    );
  });

  it('reads as "your number" when none is known, rather than leaving a gap', () => {
    process.env.MAIL_BODY = 'Your code is {code} for {number}.';
    expect(verificationMessage('123456', 10)).toContain('for your number');
  });
});
