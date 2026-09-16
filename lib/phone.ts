/**
 * Phone numbers are the login identifier, so they are normalised to a single
 * canonical form: "+" followed by 7-15 digits, no spaces or punctuation.
 * Nothing here proves ownership of a number — without an SMS provider there is
 * no verification step, only uniqueness.
 */
export function normalisePhone(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  // "00" is the international prefix in much of the world; E.164 writes the same thing as "+".
  const prefixed = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  const digits = prefixed.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  // An E.164 country code never begins with 0, so a leading zero is a trunk prefix (or an
  // escaped one) and not part of the identity. Dropping it is what stops "+06591234567",
  // "006591234567", "6591234567" and "+6591234567" from becoming four different accounts
  // for one handset — which would also split that handset's code-sending budget four ways.
  const canonical = digits.replace(/^0+/, '');
  if (canonical.length < 7 || canonical.length > 15) return null;
  return `+${canonical}`;
}

/** "+6591234567" -> "6591234567" (the key used for the phone index) */
export function phoneKey(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/** A gentle display form: +65 9123 4567 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 8) return phone;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
}

/** True when the text could be someone typing a phone number rather than a handle. */
export function looksLikePhone(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 7) return false;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Reject a pure-username string such as "user1234" that happens to be long.
  return /^[+\d][\d\s\-().]*$/.test(trimmed);
}
