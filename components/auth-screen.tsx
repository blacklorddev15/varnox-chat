'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { IconLogo } from './icons';

export function AuthScreen({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        await post('/api/auth/register', { phone: identifier, displayName, password });
      } else {
        await post('/api/auth/login', { identifier, password });
      }
      router.replace(next && next.startsWith('/') ? next : '/chat');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <IconLogo size={52} />
        <h1>{mode === 'login' ? 'Welcome back to Varnox' : 'Create your Varnox account'}</h1>
        <p className="sub">
          {mode === 'login'
            ? 'Sign in with your phone number to pick up your chats, groups and voice notes.'
            : 'Register with your phone number, then find people by their number to start chatting.'}
        </p>

        <form onSubmit={submit}>
          <div className="field-row">
            <label htmlFor="identifier">
              {mode === 'login' ? 'Phone number' : 'Phone number'}
            </label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="+65 9123 4567"
              autoComplete="tel"
              inputMode="tel"
              required
            />
            {mode === 'login' ? (
              <p className="hint" style={{ marginTop: 6 }}>
                Accounts created earlier can still sign in with their username here.
              </p>
            ) : null}
          </div>

          {mode === 'register' ? (
            <div className="field-row">
              <label htmlFor="displayName">Your name</label>
              <input
                id="displayName"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
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
              placeholder={mode === 'register' ? 'At least 6 characters' : '••••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </div>

          {error ? <p className="error">{error}</p> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="switch-line">
          {mode === 'login' ? (
            <>
              New to Varnox?{' '}
              <button type="button" onClick={() => { setMode('register'); setError(''); }}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => { setMode('login'); setError(''); }}>
                Sign in
              </button>
            </>
          )}
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          Include your country code, for example <b>+65 9123 4567</b>. No SMS is sent — the number is
          your login ID, protected by the password you choose. Messages stay on your own Varnox
          server and are not shared with any other messenger.
        </p>
      </div>
    </div>
  );
}
