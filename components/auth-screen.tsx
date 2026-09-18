'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, patch, post, uploadImage } from '@/lib/client';
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

type Step = 'phone' | 'code' | 'name' | 'password' | 'link' | 'reset';

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

/**
 * What the sign-in screen says when the browser comes back from Google without a session.
 *
 * These are the other half of the callback route: it deliberately redirects with a short reason
 * code rather than prose, because the wording belongs next to the form the visitor is looking
 * at rather than in a URL. A code with no entry here falls back to a generic line, so a reason
 * added on the server later degrades to something readable instead of showing a raw key.
 */
const GOOGLE_ERRORS: Record<string, string> = {
  unconfigured: 'Google sign-in is not set up on this server yet. Use your phone number instead.',
  denied: 'Google sign-in was cancelled.',
  state: 'That sign-in took too long, or began in a different browser. Please try again.',
  exchange: 'Google could not confirm the sign-in. Please try again.',
  keys: 'Could not reach Google to check the sign-in. Please try again in a moment.',
  token: 'Google returned something that could not be verified. Please try again.',
  gone: 'That Google account is not attached to an active Varnox account.',
};

export function AuthScreen({
  next,
  google,
  googleReady,
  startRegister,
}: {
  next?: string;
  /** Why the browser is back from Google, when it is. */
  google?: string;
  /**
   * Whether this deployment has Google credentials at all. Decided on the server, so a
   * deployment without them does not offer a button that can only explain itself after a full
   * trip to Google and back.
   */
  googleReady?: boolean;
  /**
   * Open with the registration wizard already showing, rather than the sign-in form.
   *
   * This exists for the welcome screen, whose only action is "Get Started" — landing on a
   * sign-in form after pressing it would be the wrong half of the component. It sets the same
   * two pieces of state the "Create an account" link sets, just at first render instead of on a
   * click, so there is still only one way into the wizard.
   */
  startRegister?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(startRegister ? 'phone' : 'password');

  const [country, setCountry] = useState('');
  const [number, setNumber] = useState('');

  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [seconds, setSeconds] = useState(0);

  const [name, setName] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  /** The code shown by a device that is already signed in, typed here to sign this one in. */
  const [linkCode, setLinkCode] = useState('');
  const [passwordMode, setPasswordMode] = useState<'login' | 'register'>(
    startRegister ? 'register' : 'login'
  );

  /**
   * Recovering an account, as three small steps rather than a screen of its own.
   *
   * 'ask' takes the email and the number, 'code' takes the code and the new password, and 'done'
   * says it worked. Both halves of the pair have to name the same account on the server — a number
   * that belongs to somebody else is refused — which is why the two are asked together and why the
   * refusal does not say which half was wrong.
   */
  const [resetStage, setResetStage] = useState<'ask' | 'code' | 'done'>('ask');
  const [resetEmail, setResetEmail] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  /**
   * Creating an account collects a phone number, then a username and an address, then a
   * password, then an optional profile picture, then the terms, then a decision about
   * notifications, one step at a time. The username is the handle people search for, which is
   * why it is asked for rather than generated silently.
   */
  const [signupStep, setSignupStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [username, setUsername] = useState('');
  /**
   * The address a confirmation code is sent to. Optional here for the same reason it is optional
   * everywhere else: the number is what signs you in.
   *
   * Asked at signup because the server has always accepted an address on this request and no
   * client ever sent one, which left the code-sending path in the register route unreachable —
   * and because "confirm the address you signed up with" needs an address to have been given.
   */
  const [signupEmail, setSignupEmail] = useState('');
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
  const [notice, setNotice] = useState('');
  /* The recorded code, once somebody asks to see it. Null means they have not asked. */
  const [devSms, setDevSms] = useState<{ body: string; code: string | null } | null>(null);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);

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

  /**
   * What to do on the way back from Google.
   *
   * Runs once. The query string is how the callback reports its outcome, and re-reading it on
   * every render would keep re-applying a message the visitor has already moved past.
   *
   * A first-time Google visitor is switched into the ordinary signup wizard rather than being
   * signed up here, and that is the decision worth noticing: the wizard asks for a phone number
   * first, and that number then goes through exactly the checks a phone signup goes through,
   * including the block list. Creating an account during the callback instead would have meant
   * a second way into the database that has to remember to repeat every one of them.
   */
  useEffect(() => {
    if (!google) return;
    if (google === 'new') {
      setPasswordMode('register');
      setSignupStep(1);
      setStep('password');
      setNotice('');
      setError('');
      return;
    }
    setError(GOOGLE_ERRORS[google] ?? 'Google sign-in did not complete. Please try again.');
  }, []);

  useEffect(
    () => () => {
      if (photoObjectUrl.current) URL.revokeObjectURL(photoObjectUrl.current);
    },
    []
  );

  /**
   * Send the confirmation code.
   *
   * The code goes to the EMAIL, not the number. The number is still collected — it is how people
   * find you and one of the ways to sign in — but proving you can receive a text costs money per
   * message and proving you can read a mailbox does not. This is the only verification the wizard
   * does, so it is also the only thing standing between a typed address and an account that claims
   * it.
   */
  async function startReset(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/reset/start', { email: resetEmail.trim(), phone: resetPhone.trim() });
      setResetCode('');
      setResetStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function finishReset(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/reset/confirm', {
        email: resetEmail.trim(),
        phone: resetPhone.trim(),
        code: resetCode.replace(/\D/g, ''),
        password: resetPassword,
      });
      setResetCode('');
      setResetPassword('');
      setResetStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const phone = composed();
    if (phone.replace(/\D/g, '').length < 7) {
      setError('Enter your number, including the country code');
      return;
    }
    /*
      There is one code and it goes to the email — no SMS anywhere.

      This screen only ever registers now. Signing in is the password step, reached from the link
      at the bottom, which is why nothing here has to ask which of the two it is doing.
    */
    const email = signupEmail.trim();
    if (!email) {
      setError('Enter your email address — the code is sent there');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await post<{ to: string; expiresInSec: number; resendInSec: number }>(
        '/api/auth/email/send',
        { email, phone, dial: country }
      );
      setDigits(Array(CODE_LENGTH).fill(''));
      setNotice(`We sent a 6-digit code to ${res.to}`);
      setDevSms(null);
      setSmsCopied(false);
      setSeconds(res.resendInSec || 60);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask for the code that was recorded instead of texted.
   *
   * The server decides what may be shown: a code comes back only for a number that has no
   * account yet, so this can help somebody join but can never reach into an existing account.
   * Everything the server declines arrives as "nothing to show", which is what the screen says.
   */
  async function loadDevSms() {
    if (smsBusy) return;
    setSmsBusy(true);
    setError('');
    try {
      const res = await api<{ available: boolean; body?: string; code?: string | null }>(
        `/api/auth/otp/inbox?phone=${encodeURIComponent(composed())}`
      );
      if (!res.available || !res.body) {
        setError('There is no code to show for this number.');
        return;
      }
      setDevSms({ body: res.body, code: res.code ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look that up');
    } finally {
      setSmsBusy(false);
    }
  }

  async function copyDevSms() {
    if (!devSms) return;
    try {
      await navigator.clipboard.writeText(devSms.code ?? devSms.body);
      setSmsCopied(true);
      window.setTimeout(() => setSmsCopied(false), 2000);
    } catch {
      /* Some browsers refuse the clipboard without a secure context or a direct gesture. */
      setError('Could not copy — select the code above and copy it by hand.');
    }
  }

  async function submitCode(value: string) {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    setError('');
    try {
      /**
       * The code proves the address. It does not sign anybody in and it creates nothing.
       *
       * That is the change from the old step, which called /api/auth/otp/verify, made a
       * passwordless account on the spot, and jumped the wizard to the picture — so a new account
       * never chose a username or a password at all. Now the account is made at the end, from the
       * number, the username and the password gathered along the way.
       *
       * The proof stays server-side: this marks the code row consumed, and /api/auth/register
       * refuses an address that has no such row.
       */
      await post('/api/auth/email/confirm', { email: signupEmail.trim(), code: value });
      setName('');
      setSignupStep(2);
      setStep('password');
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
      /* This used to be finish(), which is why joining by phone skipped the whole back half of
         the wizard: no picture, no terms, no notifications — three things the password route
         asks everybody.
         The account already exists by now, because the code step created it, so there is no
         password to set. The wizard simply resumes at the picture and runs the remaining steps,
         which submit through the same form and advance the same way. */
      setPasswordMode('register');
      setSignupStep(4);
      setStep('password');
      setBusy(false);
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
          // Blank is sent as-is and the server treats it as no address at all, so the wizard
          // does not have to decide whether the field was filled in.
          email: signupEmail,
          // Nothing about Google is sent from here. The claim that a Google account was
          // verified travels in an httpOnly cookie the callback set, which the server reads —
          // so this request is byte-for-byte what it was before Google existed.
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
                  Include the country code, for example +65 9123 4567. This is how people find you.
                </p>
              </div>

              {/* Asked here, beside the number, because the code is sent to it — the two belong
                  together on the screen where the visitor is proving who they are. Only while
                  registering: signing in proves the number instead, and has no use for this. */}
              <div className="field-row">
                <label htmlFor="signupEmail">Email address</label>
                  <input
                    id="signupEmail"
                    className="input"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoComplete="email"
                    required
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                  We'll send your 6-digit code here and nowhere else.
                </p>
              </div>

              {error ? <p className="error">{error}</p> : null}

              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Get code'}
              </button>
            </form>

            {/*
              The way back for somebody who already has an account.

              It goes to the sign-in half of this same component rather than out to a URL, so the
              one screen keeps both jobs and there is no second form to keep in step. Deliberately
              the only secondary action here: "Use a password instead" and "Link a device" were
              removed, and with the number step now being where an account is created, a link back
              to signing in is the only thing a visitor here could still want.
            */}
            <div className="switch-line">
              <button
                type="button"
                onClick={() => {
                  setPasswordMode('login');
                  setStep('password');
                  setError('');
                  setNotice('');
                }}
              >
                Login if you have account
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

            {/* There is no SMS to check, so the phone step's promise is kept here instead.
                What may be shown is the server's decision, never this screen's. */}
            {devSms ? (
              <div className="dev-sms">
                <p className="dev-sms-label">Your code</p>
                {devSms.code ? <p className="dev-sms-code">{devSms.code}</p> : null}
                <p className="dev-sms-body">{devSms.body}</p>
                <div className="dev-sms-actions">
                  <button type="button" className="btn ghost" onClick={() => void copyDevSms()}>
                    {smsCopied ? 'Copied' : 'Copy'}
                  </button>
                  {devSms.code ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setDigits((devSms.code ?? '').split(''))}
                    >
                      Use this code
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <button type="button" className="dev-sms-link" onClick={() => void loadDevSms()}>
                {smsBusy ? 'Looking…' : 'Show the code instead'}
              </button>
            )}

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

        {step === 'reset' ? (
          <>
            <h1>Reset your password</h1>

            {resetStage === 'done' ? (
              <>
                <p className="sub">
                  Your password has been changed. Sign in with the new one.
                </p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setResetStage('ask');
                    setPasswordMode('login');
                    setError('');
                    setStep('password');
                  }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                <p className="sub">
                  Enter the email and the number on the account. A code goes to the email, and both
                  have to match the same account — so a number that is not yours will not work.
                </p>

                <form onSubmit={resetStage === 'ask' ? startReset : finishReset}>
                  <div className="field-row">
                    <label htmlFor="resetEmail">Email address</label>
                    <input
                      id="resetEmail"
                      className="input"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="field-row">
                    <label htmlFor="resetPhone">Phone number on the account</label>
                    <input
                      id="resetPhone"
                      className="input"
                      value={resetPhone}
                      onChange={(e) => setResetPhone(e.target.value)}
                      placeholder="254712345678"
                      inputMode="tel"
                      required
                    />
                    <p className="hint" style={{ marginTop: 6 }}>
                      Include the country code. It is never texted — it is checked against the
                      account, which is what makes it worth asking for.
                    </p>
                  </div>

                  {resetStage === 'code' ? (
                    <>
                      <div className="field-row">
                        <label htmlFor="resetCode">Code from the email</label>
                        <input
                          id="resetCode"
                          className="input"
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value)}
                          placeholder="000000"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          required
                        />
                      </div>

                      <div className="field-row">
                        <label htmlFor="resetPassword">New password</label>
                        <input
                          id="resetPassword"
                          className="input"
                          type="password"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          autoComplete="new-password"
                          minLength={6}
                          required
                        />
                        <p className="hint" style={{ marginTop: 6 }}>
                          At least 6 characters.
                        </p>
                      </div>
                    </>
                  ) : null}

                  {error ? <p className="error">{error}</p> : null}

                  <button className="btn" type="submit" disabled={busy}>
                    {busy
                      ? 'Please wait…'
                      : resetStage === 'ask'
                        ? 'Send a code'
                        : 'Change my password'}
                  </button>
                </form>

                <div className="switch-line">
                  <button
                    type="button"
                    onClick={() => {
                      setResetStage('ask');
                      setError('');
                      setStep('password');
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            )}
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
              {/*
                Beside "Use a password instead" rather than on the front door: this is for somebody
                who already has an account, and the front door is for people who do not.
              */}
              <button
                type="button"
                onClick={() => {
                  setResetStage('ask');
                  setError('');
                  setStep('reset');
                }}
              >
                Forgot your password?
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
                <>
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
                </>
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
