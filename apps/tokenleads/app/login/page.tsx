'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/clientApi';
import { useApp, Me } from '@/lib/store';
import { IconSparkles } from '@/components/Icons';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const next = useSearchParams().get('next') || '/dashboard';
  const setAuth = useApp((s) => s.setAuth);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api<{ user: Me; balance: number }>('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      setAuth(d.user, d.balance);
      router.push(next);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? 'Hibás e-mail vagy jelszó.' : 'Hiba történt, próbáld újra.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-head">
          <span className="brand-mark"><IconSparkles size={22} /></span>
          <h1>Üdv újra a TokenLeadsben</h1>
          <p>Lépj be a fiókodba a folytatáshoz.</p>
        </div>
        {err && <div className="notice err" role="alert">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" className="input" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Jelszó</label>
            <input id="password" className="input" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 6 }}>
            {busy ? 'Belépés…' : 'Belépés'}
          </button>
        </form>
        <p className="auth-alt">Nincs még fiókod? <Link href="/register">Regisztrálj ingyen</Link></p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
