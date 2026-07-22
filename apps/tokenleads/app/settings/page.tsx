'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/clientApi';
import { useLang, setLang, t } from '@/lib/i18n';
import { useApp } from '@/lib/store';
import { IconCoin } from '@/components/Icons';

interface KeyRow { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string; }
interface Referral { code: string; link: string; invited: number; rewarded: number; bonus: number; }

export default function SettingsPage() {
  const lang = useLang();
  const { me } = useApp();
  const [dark, setDark] = useState(false);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newKey, setNewKey] = useState('');
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    // Read the stored preference, not the DOM — the Shell applies the theme in
    // a parent effect that runs AFTER this child effect on first mount.
    try {
      const stored = localStorage.getItem('tl_theme');
      setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch { /* no storage */ }
    api<Referral>('/api/referrals').then(setReferral).catch(() => {});
    api<{ keys: KeyRow[] }>('/api/keys').then((d) => setKeys(d.keys)).catch(() => {});
  }, []);

  function toggleTheme(next: boolean) {
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('tl_theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
  }

  async function createKey() {
    const d = await api<{ key: string; id: string; prefix: string }>('/api/keys', {
      method: 'POST', body: JSON.stringify({ name: keyName || 'API kulcs' }),
    });
    setNewKey(d.key);
    setKeyName('');
    api<{ keys: KeyRow[] }>('/api/keys').then((r) => setKeys(r.keys)).catch(() => {});
  }

  async function revoke(id: string) {
    await api(`/api/keys/${id}`, { method: 'DELETE' });
    setKeys((ks) => ks.filter((k) => k.id !== id));
  }

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  return (
    <div>
      <div className="section">
        <h2 style={{ marginTop: 0 }}>Megjelenés és nyelv</h2>
        <div className="row" style={{ alignItems: 'center', gap: 24 }}>
          <label className="check" style={{ gap: 10 }}>
            <span className="switch">
              <input type="checkbox" checked={dark} onChange={(e) => toggleTheme(e.target.checked)} />
              <span className="knob" />
            </span>
            {t('theme.toggle', lang)}
          </label>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Nyelv / Language:</span>
            <select className="input" style={{ width: 140 }} value={lang} onChange={(e) => setLang(e.target.value as 'hu' | 'en')}>
              <option value="hu">Magyar</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Az angol fordítás a navigációra és a fő gombokra terjed ki — a teljes felület fordítása folyamatban.
        </p>
      </div>

      <div className="section">
        <h2 style={{ marginTop: 0 }}>Ajánlási program</h2>
        {referral ? (
          <>
            <p className="sub" style={{ marginBottom: 10 }}>
              Hívd meg az ismerőseid: amikor megerősítik az e-mail címüket, <b>mindketten +{referral.bonus} tokent</b> kaptok.
            </p>
            <div className="row" style={{ alignItems: 'center' }}>
              <code className="keycode" style={{ flex: 1, minWidth: 220 }}>{referral.link}</code>
              <button className="btn sm" onClick={() => copy(referral.link, 'ref')}>Link másolása</button>
              {copied === 'ref' && <span className="copy-ok">Másolva ✓</span>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Eddig meghívva: <b>{referral.invited}</b> · jutalmazott: <b>{referral.rewarded}</b>
            </p>
          </>
        ) : <p className="muted">{t('common.loading', lang)}</p>}
      </div>

      <div className="section">
        <h2 style={{ marginTop: 0 }}>API kulcsok</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Programozott hozzáférés ugyanazzal a token-egyenleggel. A kulcsot <b>egyszer</b> mutatjuk meg — tárold biztonságosan.
        </p>
        {newKey && (
          <div className="notice ok" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <code className="keycode" style={{ flex: 1, minWidth: 220 }}>{newKey}</code>
            <button className="btn sm" onClick={() => copy(newKey, 'key')}>Másolás</button>
            {copied === 'key' && <span className="copy-ok">Másolva ✓</span>}
          </div>
        )}
        <div className="row" style={{ marginBottom: 14 }}>
          <input className="input" style={{ width: 240 }} placeholder="kulcs neve (pl. CRM integráció)"
            value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <button className="btn sm" onClick={createKey}><IconCoin size={14} /> Új kulcs</button>
        </div>
        {keys.map((k) => (
          <div className="list-row" key={k.id}>
            <div className="grow">
              <div className="nm">{k.name} <span className="muted mono" style={{ fontWeight: 400 }}>({k.prefix})</span></div>
              <div className="ds">létrehozva {fmtDate(k.createdAt)}{k.lastUsedAt ? ` · utoljára használva ${fmtDate(k.lastUsedAt)}` : ' · még nem használt'}</div>
            </div>
            <button className="btn ghost sm" onClick={() => revoke(k.id)}>Visszavonás</button>
          </div>
        ))}
        {!keys.length && <p className="muted" style={{ fontSize: 13 }}>Még nincs API kulcsod.</p>}
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Használati példa</summary>
          <code className="keycode" style={{ marginTop: 8 }}>
            curl -H &quot;Authorization: Bearer tl_live_…&quot; &quot;{typeof window !== 'undefined' ? location.origin : ''}/api/leads/search?category=Villanyszerel%C5%91&quot;
          </code>
        </details>
      </div>

      <div className="section">
        <h2 style={{ marginTop: 0 }}>Fiók</h2>
        <div className="kv">
          <span className="k">E-mail</span><span>{me?.email}</span>
          <span className="k">Előfizetés</span><span>{me?.plan ? me.plan : 'nincs — pay-as-you-go'}</span>
          <span className="k">Szerep</span><span>{me?.role}</span>
        </div>
      </div>
    </div>
  );
}
