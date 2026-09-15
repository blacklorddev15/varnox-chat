'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch, post } from '@/lib/client';
import { IconLogo } from './icons';

/**
 * Sign-in, in the shape a phone-first messenger uses: type a number, get a code, enter
 * the code. A number that has never been seen becomes an account on the spot, so there
 * is no separate "register" step — only a name to set afterwards.
 *
 * Password sign-in still exists, one tap behind "Use a password instead", because
 * accounts created before phone login did have a password and must keep working.
 */

type Step = 'phone' | 'code' | 'name' | 'password';

type Country = { dial: string; label: string };

/** Common dial codes offered as a shortcut. Anything else can be typed with a leading +. */
const COUNTRIES: Country[] = [
  { dial: '92', label: 'Pakistan' },
  { dial: '1', label: 'United States / Canada' },
  { dial: '44', label: 'United Kingdom' },
  { dial: '91', label: 'India' },
  { dial: '65', label: 'Singapore' },
  { dial: '60', label: 'Malaysia' },
  { dial: '62', label: 'Indonesia' },
  { dial: '63', label: 'Philippines' },
  { dial: '880', label: 'Bangladesh' },
  { dial: '94', label: 'Sri Lanka' },
  { dial: '977', label: 'Nepal' },
  { dial: '971', label: 'United Arab Emirates' },
  { dial: '966', label: 'Saudi Arabia' },
  { dial: '974', label: 'Qatar' },
  { dial: '965', label: 'Kuwait' },
  { dial: '973', label: 'Bahrain' },
  { dial: '968', label: 'Oman' },
  { dial: '90', label: 'Türkiye' },
  { dial: '20', label: 'Egypt' },
  { dial: '234', label: 'Nigeria' },
  { dial: '254', label: 'Kenya' },
  { dial: '27', label: 'South Africa' },
  { dial: '233', label: 'Ghana' },
  { dial: '49', label: 'Germany' },
  { dial: '33', label: 'France' },
  { dial: '34', label: 'Spain' },
  { dial: '39', label: 'Italy' },
  { dial: '31', label: 'Netherlands' },
  { dial: '41', label: 'Switzerland' },
  { dial: '46', label: 'Sweden' },
  { dial: '48', label: 'Poland' },
  { dial: '380', label: 'Ukraine' },
  { dial: '7', label: 'Russia / Kazakhstan' },
  { dial: '86', label: 'China' },
  { dial: '81', label: 'Japan' },
  { dial: '82', label: 'South Korea' },
  { dial: '61', label: 'Australia' },
  { dial: '64', label: 'New Zealand' },
  { dial: '55', label: 'Brazil' },
  { dial: '52', label: 'Mexico' },
];

const CODE_LENGTH = 6;

export function AuthScreen({ next }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');

  const [country, setCountry] = useState('');
  const [number, setNumber] = useState('');

  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [seconds, setSeconds] = useState(0);

  const [name, setName] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordMode, setPasswordMode] = useState<'login' | 'register'>('login');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  /** The number as the API wants it: "+" and digits only. */
  function composed(): string {
    const typed = number.replace(/\D/g, '');
    if (number.trim().startsWith('+') || !country) return `+${typed}`;
    // A local number typed with a trunk zero: drop the zero when the country is known.
    return `+${country}${typed.replace(/^0+/, '')}`;
  }

  function finish() {
    router.replace(next && next.startsWith('/') ? next : '/chat');
    router.refresh();
  }

  function pickCountry(value: string) {
    // The dial code is applied by composed(), which is also what the API calls use. Keeping
    // one source of truth is what stops the on-screen confirmation from drifting away from
    // the number that is actually sent.
    setCountry(value);
  }

  useEffect(() => {
    if (seconds <= 0) return;
    const id = window.setInterval(() => setSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [seconds]);

  useEffect(() => {
    if (step === 'code') boxes.current[0]?.focus();
  }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const phone = composed();
    if (phone.replace(/\D/g, '').length < 7) {
      setError('Enter your number, including the country code');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await post<{ to: string; expiresInSec: number; resendInSec: number }>(
        '/api/auth/otp/start',
        { phone }
      );
      setDigits(Array(CODE_LENGTH).fill(''));
      setNotice(`We sent a 6-digit code to ${res.to}`);
      setSeconds(res.resendInSec || 60);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    setError('');
    try {
      const res = await post<{ user: { displayName: string }; created: boolean }>(
        '/api/auth/otp/verify',
        { phone: composed(), code: value }
      );
      if (res.created) {
        setName('');
        setStep('name');
      } else {
        finish();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setDigits(Array(CODE_LENGTH).fill(''));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function typeDigit(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    const next = [...digits];

    if (typed.length > 1) {
      // A pasted code: fill from here across the remaining boxes.
      for (let i = 0; i < typed.length && index + i < CODE_LENGTH; i++) {
        next[index + i] = typed[i];
      }
      setDigits(next);
      const landed = Math.min(CODE_LENGTH - 1, index + typed.length);
      boxes.current[landed]?.focus();
      const joined = next.join('');
      if (joined.length === CODE_LENGTH) void submitCode(joined);
      return;
    }

    next[index] = typed;
    setDigits(next);
    if (typed && index < CODE_LENGTH - 1) boxes.current[index + 1]?.focus();
    const joined = next.join('');
    if (joined.length === CODE_LENGTH) void submitCode(joined);
  }

  function backspace(index: number) {
    const next = [...digits];
    if (next[index]) {
      next[index] = '';
      setDigits(next);
      return;
    }
    if (index > 0) {
      next[index - 1] = '';
      setDigits(next);
      boxes.current[index - 1]?.focus();
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const trimmed = name.trim();
      if (trimmed) await patch('/api/me', { displayName: trimmed });
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (passwordMode === 'register') {
        await post('/api/auth/register', { phone: identifier, displayName: name, password });
      } else {
        await post('/api/auth/login', { identifier, password });
      }
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <IconLogo size={52} />

        {step === 'phone' ? (
          <>
            <h1>Enter your phone number</h1>
            <p className="sub">
              Varnox will send you a 6-digit code to confirm it is you. Your number is how
              people find you and how you sign in.
            </p>
            <form onSubmit={sendCode}>
              <div className="field-row">
                <label htmlFor="country">Country</label>
                <select
                  id="country"
                  className="input"
                  value={country}
                  onChange={(e) => pickCountry(e.target.value)}
                >
                  <option value="">Type the number with its country code</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.dial} value={c.dial}>
                      {c.label} +{c.dial}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <label htmlFor="phone">Phone number</label>
                <input
                  id="phone"
                  className="input"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="+65 9123 4567"
                  autoComplete="tel"
                  inputMode="tel"
                  autoFocus
                  required
                />
                <p className="hint" style={{ marginTop: 6 }}>
                  {country
                    ? `We'll send the code to ${composed()}`
                    : 'Include the country code, for example +65 9123 4567.'}
                </p>
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </form>

            <div className="switch-line">
              <button type="button" onClick={() => { setStep('password'); setError(''); setNotice(''); }}>
                Use a password instead
              </button>
            </div>

            <p className="hint" style={{ marginTop: 16 }}>
              Messages stay on your own Varnox server and are not shared with any other
              messenger.
            </p>
          </>
        ) : null}

        {step === 'code' ? (
          <>
            <h1>Enter the code</h1>
            <p className="sub">{notice}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode(digits.join(''));
              }}
            >
              <div className="otp-boxes">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      boxes.current[i] = el;
                    }}
                    className="input otp-box"
                    value={digit}
                    onChange={(e) => typeDigit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace') {
                        e.preventDefault();
                        backspace(i);
                      }
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (!pasted) return;
                      e.preventDefault();
                      typeDigit(i, pasted);
                    }}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy || digits.join('').length !== CODE_LENGTH}>
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </form>

            <div className="switch-line">
              {seconds > 0 ? (
                <span className="hint">You can ask for a new code in {seconds}s</span>
              ) : (
                <button type="button" onClick={() => void sendCode()} disabled={busy}>
                  Send a new code
                </button>
              )}
              <button type="button" onClick={() => { setStep('phone'); setError(''); setNotice(''); }}>
                Change number
              </button>
            </div>
          </>
        ) : null}

        {step === 'name' ? (
          <>
            <h1>What should we call you?</h1>
            <p className="sub">
              This is the name people see in chats. You can change it later in Settings.
            </p>
            <form onSubmit={saveName}>
              <div className="field-row">
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                />
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Continue to Varnox'}
              </button>
            </form>

            <div className="switch-line">
              <button type="button" onClick={finish} disabled={busy}>
                Skip for now
              </button>
            </div>
          </>
        ) : null}

        {step === 'password' ? (
          <>
            <h1>{passwordMode === 'login' ? 'Sign in with a password' : 'Create an account'}</h1>
            <p className="sub">
              For accounts made before phone login. New accounts use the code instead.
            </p>
            <form onSubmit={submitPassword}>
              <div className="field-row">
                <label htmlFor="identifier">Phone number or username</label>
                <input
                  id="identifier"
                  className="input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="+65 9123 4567"
                  autoComplete="username"
                  required
                />
              </div>

              {passwordMode === 'register' ? (
                <div className="field-row">
                  <label htmlFor="regName">Your name</label>
                  <input
                    id="regName"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="How your name appears in chats"
                  />
                </div>
              ) : null}

              <div className="field-row">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={passwordMode === 'register' ? 'At least 6 characters' : '••••••••'}
                  autoComplete={passwordMode === 'register' ? 'new-password' : 'current-password'}
                  required
                />
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : passwordMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <div className="switch-line">
              {passwordMode === 'login' ? (
                <button type="button" onClick={() => { setPasswordMode('register'); setError(''); }}>
                  Create an account
                </button>
              ) : (
                <button type="button" onClick={() => { setPasswordMode('login'); setError(''); }}>
                  Sign in
                </button>
              )}
              <button type="button" onClick={() => { setStep('phone'); setError(''); }}>
                Use a phone code instead
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
