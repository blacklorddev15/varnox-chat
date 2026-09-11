'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { IconLogo } from './icons';

export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
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
        await post('/api/auth/register', { username, displayName, password });
      } else {
        await post('/api/auth/login', { username, password });
      }
      router.replace('/chat');
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
            ? 'Sign in to pick up your conversations, groups and photos.'
            : 'Pick a username, then find people by username to start chatting.'}
        </p>

        <form onSubmit={submit}>
          <div className="field-row">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </div>

          {mode === 'register' ? (
            <div className="field-row">
              <label htmlFor="displayName">Display name</label>
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
          Your messages are stored on your own Varnox server. Nothing here is shared with any other
          messenger.
        </p>
      </div>
    </div>
  );
}
