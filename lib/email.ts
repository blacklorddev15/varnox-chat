/**
 * Email addresses, as an account credential.
 *
 * This module only normalises and validates. Delivery lives in lib/mail.ts and the code that
 * proves an address in lib/email-code.ts, kept apart because the rules about what an address IS
 * have nothing to do with how a message about it travels — the second changes provider, the
 * first does not.
 *
 * This comment used to say nothing was sent yet. That is no longer true: a signup address gets a
 * confirmation code. A password reset still does not exist, and when it does it needs the mail
 * provider that now exists and nothing else from here.
 *
 * The rules here are deliberately the same shape as normalisePhone: produce one canonical
 * form, so that comparison, uniqueness and lookup cannot disagree about whether two strings
 * are the same mailbox.
 */

/**
 * Deliberately permissive. The only address that matters is one a mail server will accept,
 * and the only way to know that is to send to it — so this rejects the obviously malformed
 * (no @, no dot in the domain, whitespace) rather than trying to out-guess RFC 5322, which
 * would reject valid exotic addresses for no benefit.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normaliseEmail(input: unknown): string | null {
  const raw = String(input ?? '').trim().toLowerCase();
  // 6 is the shortest plausible address ("a@b.co"); 254 is the RFC total-length ceiling.
  if (raw.length < 6 || raw.length > 254) return null;
  if (!EMAIL_RE.test(raw)) return null;

  const at = raw.lastIndexOf('@');
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  // Per RFC 5321: a local part is at most 64 octets, a domain at most 253.
  if (local.length > 64 || domain.length > 253) return null;

  return raw;
}

/** True when the string looks like an address rather than a phone number or a handle. */
export function looksLikeEmail(input: string): boolean {
  return input.includes('@');
}
