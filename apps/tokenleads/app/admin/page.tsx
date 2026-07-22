'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/clientApi';
import { Pricing } from '@/lib/pricingShared';

interface AdminUser { id: string; email: string; name: string; role: string; balance: number; lifetimeSpent: number; createdAt: string; }
interface Stats { users: number; tokens: { balance: number; granted: number; spent: number }; unlocks: number; topSpenders: { email: string; lifetimeSpent: number; balance: number }[]; }
interface AdminReport { id: string; userEmail: string; leadId: string; reason: string; status: string; createdAt: string; }
interface Promo { code: string; tokens: number; maxUses: number; usedCount: number; expiresAt: string | null; }
interface OutboxMail { id: string; to: string; subject: string; html: string; status: string; createdAt: string; }
interface Recon { ranAt: string; checked: number; mismatches: unknown[]; fixed: number; }

export default function AdminPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [credit, setCredit] = useState<Record<string, { amount: string; reason: string }>>({});
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [outbox, setOutbox] = useState<OutboxMail[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [newPromo, setNewPromo] = useState({ code: '', tokens: '50', maxUses: '10' });
  const [openMail, setOpenMail] = useState('');

  useEffect(() => {
    api<{ pricing: Pricing }>('/api/admin/pricing').then((d) => setPricing(d.pricing)).catch(() => setErr('Csak adminoknak.'));
    api<{ users: AdminUser[] }>('/api/admin/users').then((d) => setUsers(d.users)).catch(() => {});
    api<Stats>('/api/admin/stats').then(setStats).catch(() => {});
    api<{ reports: AdminReport[] }>('/api/admin/reports').then((d) => setReports(d.reports)).catch(() => {});
    api<{ promos: Promo[] }>('/api/admin/promos').then((d) => setPromos(d.promos)).catch(() => {});
    api<{ emails: OutboxMail[] }>('/api/admin/outbox').then((d) => setOutbox(d.emails)).catch(() => {});
    api<{ last: Recon | null }>('/api/admin/reconciliation').then((d) => setRecon(d.last)).catch(() => {});
  }, []);

  async function resolveReport(id: string, action: 'refund' | 'reject') {
    try {
      await api(`/api/admin/reports/${id}`, { method: 'POST', body: JSON.stringify({ action }) });
      setReports((rs) => rs.filter((r) => r.id !== id));
      setNotice(action === 'refund' ? 'Visszatérítve.' : 'Elutasítva.');
    } catch { setErr('Feldolgozás sikertelen.'); }
  }

  async function createPromo() {
    try {
      await api('/api/admin/promos', {
        method: 'POST',
        body: JSON.stringify({ code: newPromo.code || undefined, tokens: Number(newPromo.tokens), maxUses: Number(newPromo.maxUses) }),
      });
      const d = await api<{ promos: Promo[] }>('/api/admin/promos');
      setPromos(d.promos);
      setNewPromo({ code: '', tokens: '50', maxUses: '10' });
      setNotice('Promó kód létrehozva.');
    } catch { setErr('Promó létrehozás sikertelen.'); }
  }

  async function savePricing(e: React.FormEvent) {
    e.preventDefault();
    if (!pricing) return;
    setNotice(''); setErr('');
    try {
      const d = await api<{ pricing: Pricing }>('/api/admin/pricing', { method: 'PUT', body: JSON.stringify(pricing) });
      setPricing(d.pricing);
      setNotice('Árak mentve — 1 percen belül élesek.');
    } catch { setErr('Mentés sikertelen.'); }
  }

  async function doCredit(id: string) {
    const c = credit[id];
    if (!c?.amount || !c?.reason) { setErr('Összeg és indoklás is kell a korrekcióhoz.'); return; }
    setNotice(''); setErr('');
    try {
      const d = await api<{ targetBalance: number }>(`/api/admin/users/${id}/credit`, {
        method: 'POST', body: JSON.stringify({ amount: Number(c.amount), reason: c.reason }),
      });
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, balance: d.targetBalance } : u)));
      setCredit((m) => ({ ...m, [id]: { amount: '', reason: '' } }));
      setNotice('Korrekció rögzítve.');
    } catch { setErr('Korrekció sikertelen.'); }
  }

  if (err && !pricing) return <div><div className="notice err">{err}</div></div>;

  return (
    <div>
      <p className="sub">Árazás, felhasználók, token-forgalom.</p>
      {notice && <div className="notice ok">{notice}</div>}
      {err && <div className="notice err">{err}</div>}

      {stats && (
        <div className="cards">
          <div className="card"><div className="k">Felhasználók</div><div className="v">{stats.users}</div></div>
          <div className="card"><div className="k">Kint lévő token</div><div className="v">{stats.tokens.balance}</div></div>
          <div className="card"><div className="k">Összes kiosztott</div><div className="v ok">{stats.tokens.granted}</div></div>
          <div className="card"><div className="k">Összes elköltött</div><div className="v bad">{stats.tokens.spent}</div></div>
          <div className="card"><div className="k">Feloldások</div><div className="v">{stats.unlocks}</div></div>
        </div>
      )}

      {pricing && (
        <div className="section">
          <h2 style={{ marginTop: 0 }}>Árazás (token)</h2>
          <form className="row" onSubmit={savePricing}>
            {(['SIGNUP_BONUS', 'SEARCH_COST', 'LEAD_UNLOCK_COST', 'CONTACT_UNLOCK_COST'] as const).map((k) => (
              <div className="field" key={k} style={{ width: 160 }}>
                <label>{k}</label>
                <input className="input" type="number" min={0} value={pricing[k]}
                  onChange={(e) => setPricing({ ...pricing, [k]: Number(e.target.value) })} />
              </div>
            ))}
            <button className="btn">Mentés</button>
          </form>
        </div>
      )}

      <h2>Felhasználók</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>E-mail</th><th>Szerep</th><th>Egyenleg</th><th>Elköltött</th><th>Korrekció (+/− token, indoklással)</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.name ? <span className="muted"> · {u.name}</span> : ''}</td>
                <td><span className={`badge ${u.role === 'admin' ? 'credit' : 'neutral'}`}>{u.role}</span></td>
                <td className="mono">{u.balance}</td>
                <td className="mono">{u.lifetimeSpent}</td>
                <td>
                  <div className="row">
                    <input className="input" style={{ width: 80 }} type="number" placeholder="±"
                      value={credit[u.id]?.amount || ''}
                      onChange={(e) => setCredit((m) => ({ ...m, [u.id]: { amount: e.target.value, reason: m[u.id]?.reason || '' } }))} />
                    <input className="input" style={{ width: 200 }} placeholder="indoklás (kötelező)"
                      value={credit[u.id]?.reason || ''}
                      onChange={(e) => setCredit((m) => ({ ...m, [u.id]: { amount: m[u.id]?.amount || '', reason: e.target.value } }))} />
                    <button className="btn sm" onClick={() => doCredit(u.id)}>OK</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats && stats.topSpenders.length > 0 && (
        <>
          <h2>Top költők</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>E-mail</th><th>Elköltött</th><th>Egyenleg</th></tr></thead>
              <tbody>
                {stats.topSpenders.map((t, i) => (
                  <tr key={i}><td>{t.email || '?'}</td><td className="mono">{t.lifetimeSpent}</td><td className="mono">{t.balance}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Hibás adat bejelentések {reports.length > 0 && <span className="badge debit">{reports.length} függő</span>}</h2>
      {!reports.length ? <p className="muted">Nincs függő bejelentés.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Mikor</th><th>Felhasználó</th><th>Indok</th><th>Művelet</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td className="muted mono">{fmtDate(r.createdAt)}</td>
                  <td>{r.userEmail}</td>
                  <td>{r.reason} <a href={`/leads/${r.leadId}`} className="muted" style={{ fontSize: 12 }}>lead →</a></td>
                  <td>
                    <button className="btn sm" onClick={() => resolveReport(r.id, 'refund')}>Visszatérítés</button>{' '}
                    <button className="btn ghost sm" onClick={() => resolveReport(r.id, 'reject')}>Elutasítás</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Promóciós kódok</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 140 }} placeholder="kód (üres = auto)"
          value={newPromo.code} onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} />
        <input className="input" style={{ width: 100 }} type="number" placeholder="token"
          value={newPromo.tokens} onChange={(e) => setNewPromo({ ...newPromo, tokens: e.target.value })} />
        <input className="input" style={{ width: 110 }} type="number" placeholder="max. felh."
          value={newPromo.maxUses} onChange={(e) => setNewPromo({ ...newPromo, maxUses: e.target.value })} />
        <button className="btn sm" onClick={createPromo}>Létrehozás</button>
      </div>
      {promos.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Kód</th><th>Token</th><th>Felhasználva</th></tr></thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.code}>
                  <td className="mono"><b>{p.code}</b></td>
                  <td className="mono">{p.tokens}</td>
                  <td className="mono">{p.usedCount} / {p.maxUses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Rendszer-integritás</h2>
      {recon ? (
        <div className={`notice ${recon.mismatches.length ? 'err' : 'ok'}`}>
          Utolsó egyeztetés: {fmtDate(recon.ranAt)} — {recon.checked} wallet ellenőrizve,{' '}
          {recon.mismatches.length ? <b>{recon.mismatches.length} ELTÉRÉS!</b> : 'minden egyezik'}
          {recon.fixed ? ` (${recon.fixed} javítva)` : ''}
        </div>
      ) : <p className="muted">Még nem futott egyeztetés — a napi cron végzi, vagy hívd meg kézzel: <code>/api/cron/reconcile</code></p>}

      <h2>E-mail outbox {!outbox.some((m) => m.status === 'sent') && <span className="badge neutral">dev-mód</span>}</h2>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        E-mail szolgáltató nélkül a levelek itt landolnak — a verifikációs linkek innen nyithatók.
      </p>
      {!outbox.length ? <p className="muted">Üres.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Mikor</th><th>Címzett</th><th>Tárgy</th><th>Státusz</th><th></th></tr></thead>
            <tbody>
              {outbox.map((m) => (
                <tr key={m.id}>
                  <td className="muted mono">{fmtDate(m.createdAt)}</td>
                  <td>{m.to}</td>
                  <td>{m.subject}</td>
                  <td><span className={`badge ${m.status === 'sent' ? 'credit' : m.status === 'failed' ? 'debit' : 'neutral'}`}>{m.status}</span></td>
                  <td><button className="btn ghost sm" onClick={() => setOpenMail(openMail === m.id ? '' : m.id)}>
                    {openMail === m.id ? 'bezár' : 'megnyit'}
                  </button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openMail && (
        <div className="section" style={{ marginTop: 12 }}
          dangerouslySetInnerHTML={{ __html: outbox.find((m) => m.id === openMail)?.html || '' }} />
      )}
    </div>
  );
}
