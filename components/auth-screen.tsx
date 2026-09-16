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

type Step = 'phone' | 'name' | 'password' | 'link';

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


/**
 * PLAIN-LANGUAGE PLACEHOLDER, NOT LEGAL ADVICE.
 *
 * This is a short, readable summary of what the service is and what it expects of the
 * person using it, written in the voice of the rest of the app. It is a placeholder: the
 * owner of this Varnox deployment should replace it with their own terms and have them
 * checked by someone qualified before relying on them. Until then it is a fair description
 * of how the app behaves, not a contract.
 */
const TERMS_SUMMARY: string[] = [
  'Varnox is a small messaging service you run or join through your own server. It is provided as it is, with no promise that it will always be available, fast, or free of faults.',
  'You must be old enough to use it: at least 13, or the age of digital consent where you live if that is higher.',
  'Be decent to other people. Do not use Varnox to harass, threaten, bully or spam anyone, and do not use it for anything illegal.',
  'The messages, photos and voice notes you send are stored on this Varnox server so they can be delivered and read back. They are not shared with any other messenger, and they are not end-to-end encrypted.',
  'You can delete your account at any time, and you can ask for a copy of the information held about you.',
  'Accounts that abuse the service — spamming, harassment or anything illegal — may be suspended or removed.',
];

/** What the notifications step can end up saying. */
type NotifyOutcome = 'granted' | 'denied' | 'dismissed' | 'unavailable' | 'skipped';

export function AuthScreen({ next }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');

  const [country, setCountry] = useState('');
  const [number, setNumber] = useState('');

  const [seconds, setSeconds] = useState(0);

  const [name, setName] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  /** The code shown by a device that is already signed in, typed here to sign this one in. */
  const [linkCode, setLinkCode] = useState('');
  const [passwordMode, setPasswordMode] = useState<'login' | 'register'>('login');
  /**
   * Creating an account collects a phone number, then a username, then a password, then an
   * optional profile picture, then the terms, then a decision about notifications, one step
   * at a time. The username is the handle people search for, which is why it is asked for
   * rather than generated silently.
   */
  const [signupStep, setSignupStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [username, setUsername] = useState('');
  /** Step 5: the wizard only moves on with the box ticked. */
  const [termsAccepted, setTermsAccepted] = useState(false);
  /** Step 6: null until the permission question has been answered or skipped. */
  const [notifyOutcome, setNotifyOutcome] = useState<NotifyOutcome | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  /** The uploaded address, once the picture has made it to the server. */
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  /** The picture as chosen, shown before (and even without) a successful upload. */
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoObjectUrl = useRef<string | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');


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
    /* No code is asked for any more. There is no SMS provider, so the only thing the request
       produced was an error telling somebody to go and watch a phone that would never buzz.
       The number is taken as given and the flow carries straight on to the name.

       What that gives up: the number is now unverified, and there is no phone-and-code way back
       in — signing in is by username and password, or by linking a device. Neither is a loss
       the code was actually preventing: /api/auth/register never checked a code either, so
       registering with a number that is not yours was already possible by calling it directly. */
    setStep('name');
    setBusy(false);
  }

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
    if (signupStep === 4) {
      // The picture is optional and already uploaded on its own, so there is nothing to check.
      setSignupStep(5);
      return true;
    }
    if (signupStep === 5) {
      if (!termsAccepted) {
        setError('Please agree to the terms before continuing');
        return false;
      }
      setSignupStep(6);
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

  /**
   * Ask the browser whether it will show notifications. Nothing is subscribed here and no
   * service worker is involved: the answer is reported and that is all. The API is missing
   * in some browsers and in anything not served over https, so it is checked before it is
   * called rather than being allowed to throw.
   */
  async function requestNotifications() {
    if (notifyBusy) return;
    setError('');
    if (typeof window === 'undefined' || !('Notification' in window) || !window.Notification) {
      setNotifyOutcome('unavailable');
      return;
    }
    setNotifyBusy(true);
    try {
      const answer = await window.Notification.requestPermission();
      // 'default' is what comes back when the prompt was dismissed without a choice.
      setNotifyOutcome(answer === 'granted' ? 'granted' : answer === 'denied' ? 'denied' : 'dismissed');
    } catch {
      setNotifyOutcome('unavailable');
    } finally {
      setNotifyBusy(false);
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
    // The picture, terms and notifications steps have nothing left to send, so Enter moves
    // along the same path the buttons do. Entering the app only happens from step 6.
    if (passwordMode === 'register' && signupStep > 3) {
      advanceSignup();
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
              Your number is how people find you on Varnox. You will pick a username and a
              password next, and that is how you sign in.
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
                    ? `Your number will be ${composed()}`
                    : 'Include the country code, for example +65 9123 4567.'}
                </p>
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                Continue
              </button>
            </form>

            <div className="switch-line">
              <button type="button" onClick={() => { setStep('password'); setError(''); }}>
                Use a password instead
              </button>
              <button type="button" onClick={() => { setStep('link'); setError(''); }}>
                Link a device
              </button>
            </div>

            <p className="hint" style={{ marginTop: 16 }}>
              Messages stay on your own Varnox server and are not shared with any other
              messenger.
            </p>
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
              Step {signupStep} of 6 —{' '}
              {signupStep === 1
                ? 'your phone number'
                : signupStep === 2
                  ? 'a username'
                  : signupStep === 3
                    ? 'a password'
                    : signupStep === 4
                      ? 'a profile picture'
                      : signupStep === 5
                        ? 'the terms'
                        : 'notifications'}
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

              {signupStep === 5 ? (
                <>
                  <div className="terms-box">
                    {TERMS_SUMMARY.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>

                  <label className="terms-agree">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => {
                        setTermsAccepted(e.target.checked);
                        if (e.target.checked) setError('');
                      }}
                    />
                    <span>I have read and agree to these terms</span>
                  </label>
                </>
              ) : null}

              {signupStep === 6 ? (
                <>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Varnox can tell you when a new message arrives, so you do not have to keep
                    the app open to notice one. Your browser will ask you to confirm; you can
                    change your answer later in its settings.
                  </p>

                  {notifyOutcome === 'granted' || notifyOutcome === 'unavailable' ? null : (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void requestNotifications()}
                      disabled={notifyBusy}
                    >
                      {notifyBusy ? 'Asking…' : 'Turn on notifications'}
                    </button>
                  )}

                  {notifyOutcome ? (
                    <p className="hint" style={{ marginTop: 6 }}>
                      {notifyOutcome === 'granted'
                        ? 'Notifications are on. You will be told when a message arrives.'
                        : notifyOutcome === 'denied'
                          ? 'Notifications are blocked for this site. You can allow them again in your browser settings.'
                          : notifyOutcome === 'dismissed'
                            ? 'The question was dismissed, so notifications stay off for now.'
                            : notifyOutcome === 'unavailable'
                              ? 'This browser does not offer notifications, so there is nothing to turn on.'
                              : 'Notifications stay off for now. You can turn them on later in Settings.'}
                    </p>
                  ) : null}
                </>
              ) : null}

              {error ? <p className="error">{error}</p> : null}

              {signupStep < 3 || signupStep === 4 ? (
                <button className="btn" type="button" onClick={advanceSignup}>
                  Continue
                </button>
              ) : signupStep === 3 ? (
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create account'}
                </button>
              ) : signupStep === 5 ? (
                <button
                  className="btn"
                  type="button"
                  onClick={advanceSignup}
                  disabled={!termsAccepted}
                >
                  Continue
                </button>
              ) : notifyOutcome ? (
                // Nothing is awaited on the way in: the picture uploads on its own, and
                // finishing is immediate whether or not it has landed.
                <button className="btn" type="button" onClick={finish}>
                  Get started
                </button>
              ) : null}
            </form>

            <div className="switch-line">
              {signupStep === 6 && !notifyOutcome ? (
                <button type="button" onClick={() => setNotifyOutcome('skipped')} disabled={notifyBusy}>
                  Not now
                </button>
              ) : null}
              {signupStep > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSignupStep((s) => (s === 6 ? 5 : s === 5 ? 4 : s === 4 ? 3 : s === 3 ? 2 : 1));
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
