/**
 * SMS delivery for login codes.
 *
 * Varnox generates, hashes and verifies the code itself (see lib/otp.ts); this module
 * only hands the text to a provider. That keeps throttling and the stored hash under our
 * control, and makes changing provider an environment change rather than a rewrite. It is
 * also why the same code works against Twilio's Messages API, Vonage, MessageBird, or any
 * gateway that accepts a JSON POST.
 *
 * A different and equally valid design is a provider that manages the code for you —
 * Twilio Verify is the obvious one, at $0.05 per successful verification plus SMS fees
 * (Twilio's published price, August 2026). That approach would replace lib/otp.ts rather
 * than plug in here, so pick one and do not build both.
 */

type Provider = 'console' | 'twilio' | 'vonage' | 'messagebird' | 'generic';

import { q } from './pg';

export type SmsResult = { ok: boolean; provider: Provider; error?: string };

const PROVIDERS: Provider[] = ['console', 'twilio', 'vonage', 'messagebird', 'generic'];

export function devMode(): boolean {
  return process.env.SMS_DEV_MODE === '1';
}

function configured(): Provider | null {
  const raw = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();
  return (PROVIDERS as string[]).includes(raw) ? (raw as Provider) : null;
}

/** The text a user receives. No links or reply prompts: those are what smishers copy. */
export function loginCodeMessage(code: string, minutes: number): string {
  return `Your Varnox code is ${code}. It expires in ${minutes} minutes. If you did not ask for this, ignore this message.`;
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

/**
 * Send one login code.
 *
 * Never throws: a delivery failure is a result the caller has to handle, because the
 * route must not report success for an SMS that never left. On failure it returns
 * `ok: false` with a message safe to show a user.
 */
/**
 * Record a message so it can be read instead of texted.
 *
 * Reached from exactly one place — the dev-mode branch — so "written only in dev mode" and
 * "readable only in dev mode" are the same condition and cannot drift apart. The body carries
 * a live login code and vx_otp stores only code_hash, so recording anywhere that actually sends
 * would put plaintext codes into the database and undo the thing that design exists for. The
 * console provider deliberately does not record either: it is selectable in production, and a
 * second write path leaves the invariant holding only by convention.
 *
 * It cannot throw. Failing to write a diagnostic row must never be what stops somebody joining.
 */
async function recordOutbox(
  phone: string,
  body: string,
  provider: Provider,
  result: SmsResult
): Promise<void> {
  try {
    await q(
      `insert into vx_sms_outbox (to_phone, body, provider, ok, error, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [phone, body, provider, result.ok, result.error ?? null, Date.now()]
    );
  } catch (err) {
    console.error(
      '[varnox] could not record the SMS dev row',
      err instanceof Error ? err.message : err
    );
  }
}

export async function sendLoginCode(
  phone: string,
  code: string,
  minutes: number
): Promise<SmsResult> {
  const text = loginCodeMessage(code, minutes);

  // Explicit opt-in for local work: the code goes to the server log instead of a phone.
  // Deliberately not the default, so a misconfigured deployment cannot look like success
  // while sending nothing.
  if (devMode()) {
    console.log(`[varnox] SMS dev mode — code for ${phone}: ${code}`);
    const result: SmsResult = { ok: true, provider: 'console' };
    await recordOutbox(phone, text, 'console', result);
    return result;
  }

  const which = configured();
  if (!which) {
    console.error('[varnox] SMS_PROVIDER is not set; cannot send a login code');
    return { ok: false, provider: 'console', error: 'SMS is not configured on this server.' };
  }

  try {
    switch (which) {
      case 'console':
        console.log(`[varnox] SMS console provider — code for ${phone}: ${code}`);
        return { ok: true, provider: 'console' };
      case 'twilio':
        return await sendTwilio(phone, text);
      case 'vonage':
        return await sendVonage(phone, text);
      case 'messagebird':
        return await sendMessageBird(phone, text);
      case 'generic':
        return await sendGeneric(phone, text);
      default:
        return { ok: false, provider: 'console', error: 'SMS is not configured on this server.' };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[varnox] SMS send failed', detail);
    return { ok: false, provider: which, error: 'We could not reach the SMS provider.' };
  }
}

async function sendTwilio(phone: string, text: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !service)) {
    return { ok: false, provider: 'twilio', error: 'Twilio is not fully configured.' };
  }

  const form = new URLSearchParams({ To: phone, Body: text });
  if (service) form.set('MessagingServiceSid', service);
  else form.set('From', String(from));

  const res = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('[varnox] Twilio rejected a send', res.status, trimmed(res.body));
    return { ok: false, provider: 'twilio', error: 'The SMS provider rejected the message.' };
  }
  return { ok: true, provider: 'twilio' };
}

async function sendVonage(phone: string, text: string): Promise<SmsResult> {
  const key = process.env.VONAGE_API_KEY;
  const secret = process.env.VONAGE_API_SECRET;
  const from = process.env.VONAGE_FROM || 'Varnox';
  if (!key || !secret) {
    return { ok: false, provider: 'vonage', error: 'Vonage is not fully configured.' };
  }

  const res = await fetchJson('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      api_secret: secret,
      to: phone.replace(/[^\d]/g, ''),
      from,
      text,
    }),
  });
  if (!res.ok) {
    console.error('[varnox] Vonage rejected a send', res.status, trimmed(res.body));
    return { ok: false, provider: 'vonage', error: 'The SMS provider rejected the message.' };
  }
  // Vonage answers 200 even for a rejected message, so the per-message status is the
  // real result: "0" means accepted, anything else is a failure.
  if (!/"status"\s*:\s*"0"/.test(res.body)) {
    console.error('[varnox] Vonage message status was not 0', trimmed(res.body));
    return { ok: false, provider: 'vonage', error: 'The SMS provider rejected the message.' };
  }
  return { ok: true, provider: 'vonage' };
}

async function sendMessageBird(phone: string, text: string): Promise<SmsResult> {
  const key = process.env.MESSAGEBIRD_API_KEY;
  const originator = process.env.MESSAGEBIRD_ORIGINATOR || 'Varnox';
  if (!key) return { ok: false, provider: 'messagebird', error: 'MessageBird is not configured.' };

  const res = await fetchJson('https://rest.messagebird.com/messages', {
    method: 'POST',
    headers: {
      Authorization: `AccessKey ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ originator, recipients: [phone], body: text }),
  });
  if (!res.ok) {
    console.error('[varnox] MessageBird rejected a send', res.status, trimmed(res.body));
    return { ok: false, provider: 'messagebird', error: 'The SMS provider rejected the message.' };
  }
  return { ok: true, provider: 'messagebird' };
}

/**
 * Any gateway that takes a JSON POST.
 *
 * GENERIC_SMS_BODY is a JSON template with {to} and {text} placeholders, so a provider
 * that wants `{"recipient":"…","message":"…"}` needs configuration rather than code.
 * The text is JSON-escaped before substitution, so a quote or newline in the message
 * cannot break the payload.
 */
async function sendGeneric(phone: string, text: string): Promise<SmsResult> {
  const url = process.env.GENERIC_SMS_URL;
  if (!url) return { ok: false, provider: 'generic', error: 'GENERIC_SMS_URL is not set.' };

  const template = process.env.GENERIC_SMS_BODY || '{"to":"{to}","text":"{text}"}';
  const escapedText = JSON.stringify(text).slice(1, -1);
  const escapedPhone = JSON.stringify(phone).slice(1, -1);
  const rendered = template.replace(/\{to\}/g, escapedPhone).replace(/\{text\}/g, escapedText);

  try {
    JSON.parse(rendered);
  } catch {
    console.error('[varnox] GENERIC_SMS_BODY is not valid JSON after substitution');
    return { ok: false, provider: 'generic', error: 'The SMS gateway is misconfigured.' };
  }

  const token = process.env.GENERIC_SMS_TOKEN;
  const res = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: rendered,
  });
  if (!res.ok) {
    console.error('[varnox] Generic SMS gateway rejected a send', res.status, trimmed(res.body));
    return { ok: false, provider: 'generic', error: 'The SMS provider rejected the message.' };
  }
  return { ok: true, provider: 'generic' };
}
