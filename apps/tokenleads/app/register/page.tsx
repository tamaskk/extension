'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/clientApi';
import { useApp, Me } from '@/lib/store';
import { IconSparkles, IconCoin } from '@/components/Icons';

function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bonus, setBonus] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const ref = useSearchParams().get('ref') || '';
  const setAuth = useApp((s) => s.setAuth);

  useEffect(() => {
    fetch('/api/pricing').then((r) => r.json()).then((d) => d?.ok && setBonus(d.pricing.SIGNUP_BONUS)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api<{ user: Me; balance: number }>('/api/auth/register', {
        method: 'POST', body: JSON.stringify({ name, email, password, ref }),
      });
      setAuth(d.user, d.balance);
      router.push('/dashboard');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr('Ez az e-mail már regisztrálva van.');
      else if (e instanceof ApiError && e.message === 'disposable_email') setErr('Eldobható e-mail címmel nem lehet regisztrálni.');
      else if (e instanceof ApiError && e.status === 429) setErr('Túl sok regisztráció erről a hálózatról — próbáld később.');
      else if (e instanceof ApiError && e.status === 400) setErr('Érvényes e-mail és legalább 8 karakteres jelszó kell.');
      else setErr('Hiba történt, próbáld újra.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-head">
          <span className="brand-mark"><IconSparkles size={22} /></span>
          <h1>Fiók létrehozása</h1>
          <p>A(z) <b>{bonus ?? '…'} token</b> üdvözlő bónuszt az e-mail címed megerősítése után írjuk jóvá.</p>
          {ref && <p style={{ marginTop: 6 }}><span className="badge credit">Meghívó kóddal érkeztél — extra bónusz jár mindkettőtöknek!</span></p>}
        </div>
        {err && <div className="notice err" role="alert">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Név <span className="muted">(opcionális)</span></label>
            <input id="name" className="input" autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" className="input" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Jelszó <span className="muted">(min. 8 karakter)</span></label>
            <input id="password" className="input" type="password" minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 6 }}>
            {busy ? 'Létrehozás…' : <><IconCoin size={16} /> Fiók létrehozása{bonus ? ` · +${bonus} token` : ''}</>}
          </button>
        </form>
        <p className="auth-alt">Már van fiókod? <Link href="/login">Lépj be</Link></p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
