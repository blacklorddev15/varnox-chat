import { afterEach, describe, expect, it } from 'vitest';
import { mailSubject, verificationHtml, verificationMessage } from '@/lib/mail';

/**
 * The message copy is configurable, so the thing worth testing is not the wording but the rules
 * around it: the placeholder is substituted, a body that would produce an unusable email is
 * refused rather than sent, and a custom body cannot inject markup.
 *
 * The environment is restored after every case, because these functions read it on each call and
 * one test leaking a variable into the next would make a failure point at the wrong thing.
 */
const saved = {
  MAIL_BODY: process.env.MAIL_BODY,
  MAIL_SUBJECT: process.env.MAIL_SUBJECT,
};

afterEach(() => {
  for (const key of ['MAIL_BODY', 'MAIL_SUBJECT'] as const) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the confirmation message', () => {
  it('uses the built-in wording when nothing is configured', () => {
    delete process.env.MAIL_BODY;
    const text = verificationMessage('123456', 10);
    expect(text).toContain('123456');
    expect(text).toContain('10 minutes');
  });

  it('substitutes the configured wording', () => {
    process.env.MAIL_BODY = 'Enter {code} now. It dies in {minutes} minutes.';
    expect(verificationMessage('654321', 7)).toBe('Enter 654321 now. It dies in 7 minutes.');
  });

  it('refuses a body with no {code}, because that mail cannot be acted on', () => {
    process.env.MAIL_BODY = 'Hello there, welcome to Varnox.';
    const text = verificationMessage('111111', 10);
    expect(text).toContain('111111');
    expect(text).not.toContain('Hello there');
  });

  it('escapes a configured body rather than letting it inject markup', () => {
    process.env.MAIL_BODY = 'Tom & Jerry <b>code {code}</b>';
    const html = verificationHtml('222222', 5);
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>code');
  });

  it('turns blank lines in a configured body into paragraphs', () => {
    process.env.MAIL_BODY = 'First line.\n\nYour code is {code}';
    const html = verificationHtml('333333', 5);
    expect((html.match(/<p /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps a link out of either branch', () => {
    delete process.env.MAIL_BODY;
    expect(verificationHtml('444444', 5)).not.toContain('href');
  });
});

describe('the subject', () => {
  it('falls back when unset', () => {
    delete process.env.MAIL_SUBJECT;
    expect(mailSubject()).toBe('Your Varnox confirmation code');
  });

  it('uses the configured one', () => {
    process.env.MAIL_SUBJECT = 'Your code';
    expect(mailSubject()).toBe('Your code');
  });
});
