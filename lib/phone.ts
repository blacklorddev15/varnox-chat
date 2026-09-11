/**
 * Phone numbers are the login identifier, so they are normalised to a single
 * canonical form: "+" followed by 7-15 digits, no spaces or punctuation.
 * Nothing here proves ownership of a number — without an SMS provider there is
 * no verification step, only uniqueness.
 */
export function normalisePhone(input: unknown): string | null {
  const digits = String(input ?? '').replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
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
