/**
 * Email delivery for signup confirmation codes.
 *
 * Varnox generates, hashes and checks the code itself (see lib/email-code.ts). This module only
 * hands the message to a provider, exactly as lib/sms.ts does for a phone number — which is why
 * throttling and the stored hash stay under our control, and why changing provider is an
 * environment change rather than a rewrite.
 *
 * Resend is the only real provider here, unlike the five SMS gateways, and that is deliberate:
 * transactional mail APIs speak near-identical JSON for a plain send, so a second one would be
 * the same function with a different URL. `console` is the one that earns its place, because it
 * is what makes the flow testable without a domain or a bill.
 *
 * Deliberately not used: Resend's templates, audiences and contact features. The code is ours to
 * generate and check, and a provider that also held it would be a second source of truth about
 * which codes are live.
 */

type Provider = 'console' | 'resend';

import { q } from './pg';

export type MailResult = { ok: boolean; provider: Provider; error?: string };

const PROVIDERS: Provider[] = ['console', 'resend'];

/** Explicit opt-in, exactly as SMS_DEV_MODE is: the code goes to the server log, not a mailbox. */
export function devMode(): boolean {
  return process.env.MAIL_DEV_MODE === '1';
}

function configured(): Provider | null {
  const raw = (process.env.MAIL_PROVIDER ?? '').trim().toLowerCase();
  return (PROVIDERS as string[]).includes(raw) ? (raw as Provider) : null;
}

/**
 * Who the mail claims to come from, e.g. `Varnox <no-reply@varnoxapp.blacklord.tech>`.
 *
 * There is no fallback, and that is the one place this deliberately diverges from lib/sms.ts,
 * which defaults a sender name. A wrong SMS sender is ugly; a wrong mail sender is a hard
 * rejection from Resend, and the likeliest fallback — `onboarding@resend.dev` — is a shared test
 * address that only delivers to the account's own inbox. Defaulting to it would make a
 * misconfigured deployment look like it worked while every real user silently received nothing.
 */
function sender(): string | null {
  const from = (process.env.MAIL_FROM ?? '').trim();
  return from || null;
}

/**
 * The text a user receives.
 *
 * No links, on the same reasoning as the SMS message: a confirmation link is what a phishing
 * copy imitates, and the code is typed into the app the user already has open. It also means the
 * mail is useless to anyone who intercepts it without also having the session it was issued for,
 * because the endpoint that accepts a code reads the address from that session rather than from
 * the request.
 */
export function verificationMessage(code: string, minutes: number): string {
  return `Your Varnox confirmation code is ${code}. It expires in ${minutes} minutes. If you did not ask for this, ignore this message.`;
}

/**
 * The same thing with a little structure, for clients that render HTML.
 *
 * Inline styles only, and no external assets: a stylesheet or an image would be blocked or
 * stripped by most mail clients, and a remote image is a read-receipt the recipient did not
 * agree to.
 */
export function verificationHtml(code: string, minutes: number): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">',
    '<p style="margin:0 0 12px">Confirm this address for your Varnox account.</p>',
    `<p style="margin:0 0 12px;font-size:26px;font-weight:700;letter-spacing:4px">${code}</p>`,
    `<p style="margin:0 0 12px">The code expires in ${minutes} minutes. If you did not ask for this, ignore this message.</p>`,
    '<p style="margin:16px 0 0;color:#6b6b6b;font-size:13px">Varnox</p>',
    '</div>',
  ].join('');
}

function trimmed(text: string, max = 200): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

async function fetchJson(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, init);
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  return { ok: res.ok, status: res.status, body };
}

/** Pull Resend's own message out of an error body, so a setup problem names itself. */
function providerError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : null;
    if (message) return trimmed(message);
    if (typeof parsed.error === 'string') return trimmed(parsed.error);
    return null;
  } catch {
    return body.trim() ? trimmed(body) : null;
  }
}

/**
 * Record a message so it can be read instead of sent.
 *
 * Reached from exactly one place — the dev-mode branch — so "written only in dev mode" and
 * "readable only in dev mode" are the same condition and cannot drift apart. The body carries a
 * live code and vx_email_codes stores only code_hash, so recording anywhere that actually sends
 * would put plaintext codes into the database and undo the thing that design exists for. The
 * console provider deliberately does not record either: it is selectable in production, and a
 * second write path would leave the invariant holding only by convention.
 *
 * It cannot throw. Failing to write a diagnostic row must never be what stops somebody joining.
 */
async function recordOutbox(
  email: string,
  body: string,
  provider: Provider,
  result: MailResult
): Promise<void> {
  try {
    await q(
      `insert into vx_email_outbox (to_email, body, provider, ok, error, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [email, body, provider, result.ok, result.error ?? null, Date.now()]
    );
  } catch (err) {
    console.error(
      '[varnox] could not record the email dev row',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Send one confirmation code.
 *
 * Never throws: a delivery failure is a result the caller has to handle, because the route must
 * not report success for a mail that never left. On failure it returns `ok: false` with a
 * message safe to show a user — which for Resend can be a setup problem, so the provider's own
 * wording is passed through where it is short enough to be useful.
 */
export async function sendEmailCode(
  to: string,
  code: string,
  minutes: number
): Promise<MailResult> {
  const text = verificationMessage(code, minutes);
  const html = verificationHtml(code, minutes);

  // Explicit opt-in for local work: the code goes to the server log instead of a mailbox.
  // Deliberately not the default, so a misconfigured deployment cannot look like success while
  // sending nothing.
  if (devMode()) {
    console.log(`[varnox] mail dev mode — confirmation code for ${to}: ${code}`);
    const result: MailResult = { ok: true, provider: 'console' };
    await recordOutbox(to, text, 'console', result);
    return result;
  }

  const which = configured();
  if (!which) {
    console.error('[varnox] MAIL_PROVIDER is not set; cannot send a confirmation code');
    return { ok: false, provider: 'console', error: 'Email is not configured on this server.' };
  }

  try {
    switch (which) {
      case 'console':
        console.log(`[varnox] mail console provider — confirmation code for ${to}: ${code}`);
        return { ok: true, provider: 'console' };
      case 'resend':
        return await sendResend(to, code, text, html);
      default:
        return { ok: false, provider: 'console', error: 'Email is not configured on this server.' };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[varnox] mail send failed', detail);
    return { ok: false, provider: which, error: 'We could not reach the mail provider.' };
  }
}

/**
 * Resend's send endpoint.
 *
 * A plain JSON POST, so the SDK would only add a dependency. `from` is required by the API and
 * must be on a domain verified in the Resend dashboard — an unverified domain is the commonest
 * first-run failure, and it answers 403 with a message that says so, which is why that wording
 * is surfaced rather than replaced with a generic one.
 */
async function sendResend(
  to: string,
  code: string,
  text: string,
  html: string
): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = sender();
  if (!key) return { ok: false, provider: 'resend', error: 'Resend is not fully configured.' };
  if (!from) {
    return {
      ok: false,
      provider: 'resend',
      error: 'MAIL_FROM is not set, so there is no verified address to send from.',
    };
  }

  const res = await fetchJson('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Varnox confirmation code',
      text,
      html,
    }),
  });

  if (!res.ok) {
    // The status and Resend's own message, never the key: the Authorization header is not
    // logged and the response body does not echo it.
    const detail = providerError(res.body);
    console.error('[varnox] Resend rejected a send', res.status, detail ?? '');
    return {
      ok: false,
      provider: 'resend',
      error: detail ?? 'The mail provider rejected the message.',
    };
  }

  return { ok: true, provider: 'resend' };
}
