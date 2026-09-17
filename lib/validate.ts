/**
 * A small schema validator, used by the bot routes to turn an untrusted request body into a
 * typed object or a 400.
 *
 * WHY HAND-ROLLED
 *
 * The alternative is a dependency — zod or similar. This is a few dozen lines, and the deciding
 * factor is not the line count but what a request body handler needs: (1) reject anything whose
 * type, length or shape is wrong, (2) never pass the raw body through to a query, (3) return a
 * message that names the field and can be shown to the person who typed it. That is the whole
 * contract. A general schema library also does unions, transforms, coercion, refinements and
 * async parsing, none of which is wanted here, and it would be the largest runtime dependency in
 * a project whose other three are next, pg and react.
 *
 * What matters far more than which library is used is that the schema is the allowlist. A field
 * the schema does not name does not exist as far as the route is concerned — see how validate()
 * builds its result by walking the schema rather than the input. A body carrying `user_id` or
 * `token_hash` is therefore not an escalation, it is silence: the extra key is dropped before
 * anything can read it. That property is what makes it safe to hand a body straight to the
 * database layer.
 *
 * The failure mode is a thrown ValidationError, and lib/api.ts maps that to 400. Throwing rather
 * than returning a result object means a route cannot forget to check the return value: an
 * unchecked throw is not a thing that exists.
 */

export class ValidationError extends Error {
  /** Which field failed, for a caller that wants to mark it up. Not shown to end users. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** A field's parsed type, plus whether absence is allowed. The flag rides in the type. */
export type Field<Out, Optional extends boolean = false> = {
  readonly optional: Optional;
  run(raw: unknown, name: string): Out;
};

/** Pulls the parsed type out of a Field, widening it when the field is optional. */
type ValueOf<F> = F extends Field<infer Out, infer Optional>
  ? Optional extends true
    ? Out | undefined
    : Out
  : never;

export type Shape = Record<string, Field<unknown, boolean>>;

export type Validated<S extends Shape> = { [K in keyof S]: ValueOf<S[K]> };

type Labelled = { label?: string };

function label(option: Labelled, name: string): string {
  return option.label ?? name;
}

export type StringOptions = Labelled & {
  /**
   * Fold to lowercase before the length and pattern checks, and return it folded.
   *
   * Folding before the checks rather than after is the whole point. A pattern is written against
   * one case, and checking first would reject the other — so a field documented as "lowercase
   * letters" would refuse "Support-Bot" with a message about the characters in it, when the
   * caller's actual intent was that those two spellings are the same name. Doing it here also
   * means the returned value is what was measured, which is the same rule trimming follows.
   */
  lowercase?: boolean;
  /** Minimum length *after* trimming. */
  min?: number;
  /** Maximum length *after* trimming. */
  max?: number;
  /** Checked against the trimmed value. */
  pattern?: RegExp;
  /** Shown when `pattern` fails — a format hint reads better than "is invalid". */
  hint?: string;
};

/**
 * A trimmed string.
 *
 * Trimming happens before length checks and before the value is returned, so "  " is empty
 * rather than three characters, and a name of only spaces cannot pass a minimum of one. What is
 * stored is therefore exactly what was measured.
 */
export function str(options: StringOptions = {}): Field<string, false> {
  return {
    optional: false,
    run(raw, name) {
      const shown = label(options, name);
      if (raw === undefined || raw === null) throw new ValidationError(name, `${shown} is required.`);
      if (typeof raw !== 'string') throw new ValidationError(name, `${shown} must be text.`);
      const value = options.lowercase ? raw.trim().toLowerCase() : raw.trim();
      /**
       * A value that is empty and a minimum that rules that out is reported as missing rather
       * than as too short. "Bot name must be at least 1 characters" is ungrammatical and less
       * useful than "Bot name is required" — and an empty box is the ordinary case, so the
       * wording is worth getting right for it rather than for the one-character case.
       */
      if (value.length === 0 && (options.min ?? 0) >= 1) {
        throw new ValidationError(name, `${shown} is required.`);
      }
      if (options.min !== undefined && value.length < options.min) {
        throw new ValidationError(name, `${shown} must be at least ${options.min} characters.`);
      }
      if (options.max !== undefined && value.length > options.max) {
        throw new ValidationError(name, `${shown} must be ${options.max} characters or fewer.`);
      }
      if (options.pattern && !options.pattern.test(value)) {
        throw new ValidationError(name, options.hint ?? `${shown} is not in the expected format.`);
      }
      return value;
    },
  };
}

/**
 * A boolean, taking JSON's two spellings of it.
 *
 * `false` is a real value and is not the same as absent, so the fallback is only consulted when
 * the key is genuinely missing — not when it is present and false.
 */
export function bool(options: Labelled & { fallback?: boolean } = {}): Field<boolean, false> {
  return {
    optional: false,
    run(raw, name) {
      const shown = label(options, name);
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      if (raw === undefined || raw === null) {
        if (options.fallback !== undefined) return options.fallback;
      }
      throw new ValidationError(name, `${shown} must be true or false.`);
    },
  };
}

/**
 * Make a field optional.
 *
 * A blank string counts as absent as well as undefined and null, and "blank" means blank after
 * trimming — so `""` and `"   "` are both the same as leaving the box alone. The alternative,
 * treating a present-but-empty string as a value, would make an untouched optional text box
 * impossible to submit without also explaining why an empty description is invalid, and would
 * store a run of spaces as though somebody had meant it.
 *
 * Only strings are treated this way. A `false`, a `0` or an object is passed through unchanged,
 * because "blank" is not a thing those can be.
 */
export function optional<Out>(field: Field<Out, boolean>): Field<Out, true> {
  return {
    optional: true,
    run(raw, name) {
      if (raw === undefined || raw === null) return undefined as Out;
      if (typeof raw === 'string' && raw.trim() === '') return undefined as Out;
      return field.run(raw, name);
    },
  };
}

/**
 * Run a schema over an untrusted value.
 *
 * Non-objects — a JSON array, a string, null — are treated as an empty object rather than
 * rejected outright. The schema then decides: every required field fails, so a body that is not
 * an object gets the same 400 as a body that is missing everything, with a message about the
 * first field rather than about JSON shape.
 *
 * The result is built from the schema's own keys, so input keys the schema does not declare are
 * dropped instead of copied. See the note at the top of this file for why that is the important
 * half of the function.
 */
export function validate<S extends Shape>(schema: S, input: unknown): Validated<S> {
  const body =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(schema)) {
    out[name] = schema[name].run(body[name], name);
  }
  return out as Validated<S>;
}
