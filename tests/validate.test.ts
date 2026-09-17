import { describe, expect, it } from 'vitest';
import { ValidationError, bool, optional, str, validate } from '../lib/validate';

/**
 * The schema validator.
 *
 * The tests that matter most here are the two at the end — a request body is an allowlist, and a
 * field's rules are actually applied. The first is a security property (an attacker cannot smuggle
 * a key past the schema into a query), and the second is the reason the module exists at all.
 */

const schema = {
  name: str({ label: 'Bot name', min: 1, max: 80 }),
  description: optional(str({ label: 'Description', max: 500 })),
  active: optional(bool({ label: 'Active status' })),
};

describe('str', () => {
  it('returns a trimmed string', () => {
    expect(validate({ name: str() }, { name: '  hello  ' }).name).toBe('hello');
  });

  it('rejects a missing value, a null and a non-string', () => {
    expect(() => validate({ name: str() }, {})).toThrow(ValidationError);
    expect(() => validate({ name: str() }, { name: null })).toThrow(ValidationError);
    expect(() => validate({ name: str() }, { name: 12 })).toThrow(ValidationError);
    expect(() => validate({ name: str() }, { name: { toString: () => 'x' } })).toThrow(ValidationError);
  });

  it('treats a value of only spaces as empty, because trimming happens before the length check', () => {
    expect(() => validate({ name: str({ min: 1 }) }, { name: '   ' })).toThrow(ValidationError);
  });

  it('enforces a minimum and a maximum after trimming', () => {
    expect(validate({ name: str({ min: 2, max: 4 }) }, { name: 'abcd' }).name).toBe('abcd');
    expect(() => validate({ name: str({ min: 2 }) }, { name: 'a' })).toThrow(ValidationError);
    expect(() => validate({ name: str({ max: 4 }) }, { name: 'abcde' })).toThrow(ValidationError);
  });

  it('enforces a pattern, and uses the hint as the message when one is given', () => {
    const pattern = /^\d+:\w+$/;
    const shape = { token: str({ label: 'Token', pattern, hint: 'Copy it from @BotFather.' }) };
    expect(validate(shape, { token: '123:abc' }).token).toBe('123:abc');
    expect(() => validate(shape, { token: 'nope' })).toThrow('Copy it from @BotFather.');
  });

  it('names the field and the label in the message, so the form can point at it', () => {
    try {
      validate(schema, { name: '' });
      throw new Error('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).field).toBe('name');
      expect((err as ValidationError).message).toBe('Bot name is required.');
    }
  });
});

describe('bool', () => {
  it('takes real booleans', () => {
    expect(validate({ active: bool() }, { active: true }).active).toBe(true);
    expect(validate({ active: bool() }, { active: false }).active).toBe(false);
  });

  it('takes the two string spellings, for a form that posts text', () => {
    expect(validate({ active: bool() }, { active: 'true' }).active).toBe(true);
    expect(validate({ active: bool() }, { active: 'false' }).active).toBe(false);
  });

  it('refuses anything else', () => {
    expect(() => validate({ active: bool() }, { active: 'yes' })).toThrow(ValidationError);
    expect(() => validate({ active: bool() }, { active: 1 })).toThrow(ValidationError);
    expect(() => validate({ active: bool() }, {})).toThrow(ValidationError);
  });

  it('uses the fallback only when the key is absent, never when it is false', () => {
    const shape = { active: bool({ fallback: true }) };
    expect(validate(shape, {}).active).toBe(true);
    // The bug this pins down: `raw || fallback` would turn an explicit false back into true.
    expect(validate(shape, { active: false }).active).toBe(false);
  });
});

describe('optional', () => {
  // A schema whose only field is optional, so these cases are about that field and not about the
  // required one failing first.
  const onlyOptional = { description: optional(str({ label: 'Description', max: 500 })) };

  it('maps an absent key, a null and an empty string to undefined alike', () => {
    expect(validate(onlyOptional, {}).description).toBeUndefined();
    expect(validate(onlyOptional, { description: null }).description).toBeUndefined();
    expect(validate(onlyOptional, { description: '' }).description).toBeUndefined();
    expect(validate(onlyOptional, { description: '   ' }).description).toBeUndefined();
  });

  it('still applies the rules when a value is present', () => {
    expect(validate(onlyOptional, { description: 'fine' }).description).toBe('fine');
    expect(() => validate(onlyOptional, { description: 'x'.repeat(501) })).toThrow(ValidationError);
  });
});

describe('validate', () => {
  it('fills in the defaults an absent optional field needs', () => {
    const out = validate(schema, { name: 'Support' });
    expect(out).toEqual({ name: 'Support', description: undefined, active: undefined });
  });

  it('drops keys the schema does not declare', () => {
    /**
     * The important one. A request body is attacker-controlled, and the tempting implementation
     * — validate the known fields, then spread the body — carries everything else straight into
     * the query layer, where `user_id` or `token_hash` would be a way to write somebody else's
     * row. Building the result from the schema instead of the input means an undeclared key has
     * no path through this function at all.
     */
    const out = validate(schema, {
      name: 'Support',
      user_id: 'someone-else',
      token_hash: 'forged',
      active: true,
      id: 'bot_1',
    });
    expect(Object.keys(out).sort()).toEqual(['active', 'description', 'name']);
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('token_hash');
    expect(out).not.toHaveProperty('id');
  });

  it('treats a non-object body as an empty one, so required fields still fail', () => {
    expect(() => validate(schema, 'a string')).toThrow(ValidationError);
    expect(() => validate(schema, ['name'])).toThrow(ValidationError);
    expect(() => validate(schema, null)).toThrow(ValidationError);
    expect(() => validate(schema, 42)).toThrow(ValidationError);
  });

  it('accepts a non-object body when nothing is required', () => {
    expect(validate({ description: optional(str()) }, null)).toEqual({ description: undefined });
  });
});
