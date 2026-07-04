'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        const next = new URLSearchParams(window.location.search).get('next') || '/';
        window.location.href = next;
      } else { setErr(j.error || 'Login failed.'); setBusy(false); }
    } catch { setErr('Network error — try again.'); setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#eef0fb,#f7f8fd)', padding: 20 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e6e8f2', borderRadius: 18, padding: 28, boxShadow: '0 18px 50px rgba(31,41,68,.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>◧</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#1f2433' }}>GridLeads</span>
        </div>
        <p style={{ margin: '6px 0 22px', color: '#8b90a0', fontSize: 13 }}>Sign in to access your dashboard.</p>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#6b7180', marginBottom: 6 }}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username"
          style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #dfe2ee', fontSize: 14, marginBottom: 14, outline: 'none', boxSizing: 'border-box' }} />

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#6b7180', marginBottom: 6 }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #dfe2ee', fontSize: 14, marginBottom: 18, outline: 'none', boxSizing: 'border-box' }} />

        {err && <div style={{ background: 'rgba(244,63,94,.1)', color: '#e11d48', fontSize: 13, padding: '9px 11px', borderRadius: 9, marginBottom: 14 }}>⚠ {err}</div>}

        <button type="submit" disabled={busy}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: busy ? '#a5a8f0' : '#6366f1', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
