'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

/**
 * The admin password prompt.
 *
 * A second gate on top of the allowlist, and the reason it exists is narrow: the allowlist proves
 * *which account* is asking, and a signed-in session on a phone somebody picked up proves the
 * same thing. The password is what proves the person is the one holding it.
 *
 * The field is a real password input and the value is never kept in this component beyond the
 * request, so a browser password manager can offer to save it and nothing else sees it.
 */
export function AdminUnlock({ username }: { username: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/admin/unlock', { password });
      // The controls are rendered on the server from the unlock cookie, so this asks for them
      // again rather than trusting that it worked.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That password is not correct');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="admin-title">Admin control</div>
        <p className="hint" style={{ marginTop: 8 }}>
          Signed in as @{username}. Enter the admin password to continue. It is checked on the
          server and expires after 30 minutes.
        </p>

        <input
          className="input"
          type="password"
          value={password}
          autoFocus
          autoComplete="current-password"
          placeholder="Admin password"
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginTop: 14 }}
        />

        {error ? <p className="error">{error}</p> : null}

        <div className="suspend-actions">
          <button className="btn" type="submit" disabled={busy || password.length === 0}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
