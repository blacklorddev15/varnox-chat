'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch, post, uploadImage } from '@/lib/client';
import { Avatar } from './avatar';
import { IconLogo } from './icons';

/**
 * Sign-in, in the shape a phone-first messenger uses: type a number, get a code, enter
 * the code. A number that has never been seen becomes an account on the spot, so there
 * is no separate "register" step — only a name to set afterwards.
 *
 * Password sign-in still exists, one tap behind "Use a password instead", because
 * accounts created before phone login did have a password and must keep working.
 */

type Step = 'phone' | 'code' | 'name' | 'password' | 'link';

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
  /** The code shown by a device that is already signed in, typed here to sign this one in. */
  const [linkCode, setLinkCode] = useState('');
  const [passwordMode, setPasswordMode] = useState<'login' | 'register'>('login');
  /**
   * Creating an account collects a phone number, then a username, then a password, then an
   * optional profile picture, one step at a time. The username is the handle people search
   * for, which is why it is asked for rather than generated silently.
   */
  const [signupStep, setSignupStep] = useState<1 | 2 | 3 | 4>(1);
  const [username, setUsername] = useState('');
  /** The uploaded address, once the picture has made it to the server. */
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  /** The picture as chosen, shown before (and even without) a successful upload. */
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoObjectUrl = useRef<string | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

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

  useEffect(
    () => () => {
      if (photoObjectUrl.current) URL.revokeObjectURL(photoObjectUrl.current);
    },
    []
  );

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

  /**
   * Sign in with a code from a device that is already signed in. The server sets the session
   * cookie on the way back, so this leaves through the same door as every other path.
   */
  async function submitLinkCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await post('/api/link/redeem', { code: linkCode.trim() });
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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

  /**
   * Move the signup wizard on one step, checking the current answer locally first so an
   * obviously empty or malformed value never costs a round trip. Returns false when the
   * step is not satisfied.
   */
  function advanceSignup(): boolean {
    setError('');
    if (signupStep === 1) {
      if (composed().replace(/\D/g, '').length < 7) {
        setError('Enter your number, including the country code');
        return false;
      }
      setSignupStep(2);
      return true;
    }
    if (signupStep === 2) {
      const handle = username.trim().toLowerCase();
      if (handle.length < 3 || handle.length > 20 || !/^[a-z0-9._]+$/.test(handle)) {
        setError('Usernames are 3-20 characters: lowercase letters, numbers, underscore or dot');
        return false;
      }
      setUsername(handle);
      setSignupStep(3);
      return true;
    }
    return true;
  }

  /**
   * Show the picture as soon as it is chosen, then squeeze and upload it. The picture is
   * optional and the account already exists by this point, so a failed upload reports
   * itself and nothing else: the way into the app stays open.
   */
  async function pickPhoto(file: File) {
    if (photoObjectUrl.current) URL.revokeObjectURL(photoObjectUrl.current);
    const local = URL.createObjectURL(file);
    photoObjectUrl.current = local;
    setPhotoPreview(local);
    setBusy(true);
    setError('');
    try {
      // uploadImage squeezes the picture itself, so it is not compressed twice here.
      const res = await uploadImage(file);
      await patch('/api/me', { avatar: res.url });
      setAvatarUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that picture');
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Pressing Enter in the phone or username step should advance, not submit the whole form.
    if (passwordMode === 'register' && signupStep < 3) {
      advanceSignup();
      return;
    }
    // The picture step has nothing left to send, so Enter finishes like the buttons do.
    if (passwordMode === 'register' && signupStep === 4) {
      finish();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (passwordMode === 'register') {
        await post('/api/auth/register', {
          phone: composed(),
          username: username.trim().toLowerCase(),
          password,
        });
        // The session cookie is already set, so the account exists: only the optional
        // picture is left, and it is uploaded on its own rather than on the way in.
        setSignupStep(4);
      } else {
        await post('/api/auth/login', { identifier, password });
        finish();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      // Send the user back to the step that owns the problem, so a rejected username does
      // not look like a rejected password.
      if (passwordMode === 'register') {
        if (/username/i.test(message)) setSignupStep(2);
        else if (/phone/i.test(message)) setSignupStep(1);
      }
    } finally {
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
              <button type="button" onClick={() => { setStep('link'); setError(''); setNotice(''); }}>
                Link a device
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

        {step === 'link' ? (
          <>
            <h1>Link a device</h1>
            <p className="sub">
              On a device that is already signed in to Varnox, open Settings, choose Linked
              devices and tap Link a device. Type the code it shows here.
            </p>
            <form onSubmit={submitLinkCode}>
              <div className="field-row">
                <label htmlFor="link-code">Code from your other device</label>
                <input
                  id="link-code"
                  className="input"
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value)}
                  placeholder="ABCD2345"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoFocus
                  required
                />
                <p className="hint" style={{ marginTop: 6 }}>
                  The code lasts two minutes and only works once.
                </p>
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy || linkCode.trim().length < 8}>
                {busy ? 'Linking…' : 'Link this device'}
              </button>
            </form>

            <div className="switch-line">
              <button type="button" onClick={() => { setStep('phone'); setError(''); }}>
                Use a phone code instead
              </button>
              <button type="button" onClick={() => { setStep('password'); setError(''); }}>
                Use a password instead
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

        {step === 'password' && passwordMode === 'login' ? (
          <>
            <h1>Sign in with a password</h1>
            <p className="sub">Use your phone number, email address or username.</p>
            <form onSubmit={submitPassword}>
              <div className="field-row">
                <label htmlFor="identifier">Phone number, email or username</label>
                <input
                  id="identifier"
                  className="input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="+65 9123 4567"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="field-row">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : 'Sign in'}
              </button>
            </form>

            <div className="switch-line">
              <button
                type="button"
                onClick={() => {
                  setPasswordMode('register');
                  setSignupStep(1);
                  setError('');
                }}
              >
                Create an account
              </button>
              <button type="button" onClick={() => { setStep('phone'); setError(''); }}>
                Use a phone code instead
              </button>
              <button type="button" onClick={() => { setStep('link'); setError(''); }}>
                Link a device
              </button>
            </div>
          </>
        ) : null}

        {step === 'password' && passwordMode === 'register' ? (
          <>
            <h1>Create an account</h1>
            <p className="sub">
              Step {signupStep} of 4 —{' '}
              {signupStep === 1
                ? 'your phone number'
                : signupStep === 2
                  ? 'a username'
                  : signupStep === 3
                    ? 'a password'
                    : 'a profile picture'}
            </p>
            <form onSubmit={submitPassword}>
              {signupStep === 1 ? (
                <>
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
                    />
                    <p className="hint" style={{ marginTop: 6 }}>
                      {country
                        ? `This will be your number: ${composed()}`
                        : 'Include the country code, for example +65 9123 4567.'}
                    </p>
                  </div>
                </>
              ) : null}

              {signupStep === 2 ? (
                <div className="field-row">
                  <label htmlFor="signupUsername">Username</label>
                  <input
                    id="signupUsername"
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="your.name"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoFocus
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                    Lowercase letters, numbers, underscore or dot, 3-20 characters. This is how
                    people find you on Varnox.
                  </p>
                </div>
              ) : null}

              {signupStep === 3 ? (
                <>
                  <div className="field-row">
                    <label htmlFor="password">Password</label>
                    <input
                      id="password"
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      autoComplete="new-password"
                      autoFocus
                    />
                  </div>

                  <p className="hint" style={{ marginTop: 6 }}>
                    {composed()} · {username.trim().toLowerCase()}
                  </p>
                </>
              ) : null}

              {signupStep === 4 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
                    <button
                      type="button"
                      onClick={() => photoInput.current?.click()}
                      title="Choose a picture"
                    >
                      <Avatar
                        name={username.trim() || 'You'}
                        src={photoPreview ?? avatarUrl}
                        size={84}
                      />
                    </button>
                    <div>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => photoInput.current?.click()}
                        disabled={busy}
                      >
                        {busy ? 'Uploading…' : photoPreview ? 'Change picture' : 'Choose a picture'}
                      </button>
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          // Clear it so the same file can be picked again after a failure.
                          e.target.value = '';
                          if (file) void pickPhoto(file);
                        }}
                      />
                    </div>
                  </div>

                  <p className="hint" style={{ marginTop: 6 }}>
                    Optional — you can add or change it later in Settings.
                  </p>
                </>
              ) : null}

              {error ? <p className="error">{error}</p> : null}

              {signupStep < 3 ? (
                <button className="btn" type="button" onClick={advanceSignup}>
                  Continue
                </button>
              ) : signupStep === 3 ? (
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create account'}
                </button>
              ) : (
                // Nothing is awaited on the way in: the picture uploads on its own, and
                // finishing is immediate whether or not it has landed.
                <button className="btn" type="button" onClick={finish}>
                  Get started
                </button>
              )}
            </form>

            <div className="switch-line">
              {signupStep === 4 ? (
                <button type="button" onClick={finish}>
                  Skip for now
                </button>
              ) : null}
              {signupStep > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSignupStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1));
                    setError('');
                  }}
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPasswordMode('login');
                  setError('');
                }}
              >
                Sign in instead
              </button>
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
