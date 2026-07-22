'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/clientApi';
import { PACKAGES, PLANS } from '@/lib/pricingShared';
import { IconCoin, IconTrendUp, IconWallet } from '@/components/Icons';

interface Sub { plan: string; status: string; provider: string; currentPeriodEnd: string; }

interface WalletResp { balance: number; lifetimeGranted: number; lifetimeSpent: number; }
interface Tx { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: string; }

import { TYPE_LABEL } from '@/lib/txShared';

export default function WalletPage() {
  const [w, setW] = useState<WalletResp | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [promo, setPromo] = useState('');
  const [sub, setSub] = useState<Sub | null>(null);

  const load = useCallback(async (reset: boolean, cur?: string | null) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (!reset && cur) params.set('cursor', cur);
    const d = await api<{ items: Tx[]; nextCursor: string | null }>(`/api/wallet/transactions?${params.toString()}`);
    setTxs((prev) => (reset ? d.items : [...prev, ...d.items]));
    setCursor(d.nextCursor);
  }, [type]);

  useEffect(() => {
    api<WalletResp>('/api/wallet').then(setW).catch(() => {});
    api<{ subscription: Sub | null }>('/api/subscription').then((d) => setSub(d.subscription)).catch(() => {});
  }, []);
  useEffect(() => { load(true).catch(() => {}); }, [load]);

  async function buy(packageId: string) {
    setBusy(true); setNotice('');
    try {
      const d = await api<{ balance: number }>('/api/wallet/purchase', {
        method: 'POST', body: JSON.stringify({ packageId }),
      });
      setNotice(`Sikeres feltöltés (teszt-mód, fizetés nélkül) — új egyenleg: ${d.balance} token.`);
      setW((prev) => prev ? { ...prev, balance: d.balance } : prev);
      load(true).catch(() => {});
    } catch {
      setNotice('Hiba a vásárlásnál.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="sub">Minden token-mozgás egy helyen — mikor, mire, mennyit.</p>

      <div className="cards">
        <div className="card">
          <div className="stat-head"><span className="stat-ic"><IconCoin size={19} /></span><span className="k">Egyenleg</span></div>
          <div className="v">{w?.balance ?? '…'}</div>
        </div>
        <div className="card">
          <div className="stat-head"><span className="stat-ic"><IconTrendUp size={19} /></span><span className="k">Összes kapott</span></div>
          <div className="v ok">+{w?.lifetimeGranted ?? '…'}</div>
        </div>
        <div className="card">
          <div className="stat-head"><span className="stat-ic"><IconWallet size={19} /></span><span className="k">Összes elköltött</span></div>
          <div className="v bad">−{w?.lifetimeSpent ?? '…'}</div>
        </div>
      </div>

      <h2>Token feltöltés</h2>
      <p className="muted" style={{ margin: '0 0 10px' }}>Fizetési szolgáltató még nincs bekötve — a gombok teszt-módban azonnal jóváírnak.</p>
      {notice && <div className="notice ok">{notice}</div>}
      <div className="cards">
        {PACKAGES.map((p) => (
          <div className="card" key={p.id} style={{ textAlign: 'center' }}>
            <div className="k">{p.label}</div>
            <div className="v" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {p.tokens} <IconCoin size={18} />
            </div>
            <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={() => buy(p.id)}>
              ${(p.priceCents / 100).toFixed(2)} — vásárlás
            </button>
          </div>
        ))}
      </div>

      <h2>Előfizetés — havi token-keret</h2>
      {sub && sub.status === 'active' ? (
        <div className="notice ok" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            Aktív <b>{PLANS.find((p) => p.id === sub.plan)?.label || sub.plan}</b> előfizetés
            ({PLANS.find((p) => p.id === sub.plan)?.tokensPerMonth} token/hó) — következő jóváírás: {new Date(sub.currentPeriodEnd).toLocaleDateString('hu-HU')}
            {sub.provider === 'mock' ? ' [teszt-mód]' : ''}
          </span>
          <button className="btn ghost sm" onClick={async () => {
            if (!confirm('Biztosan lemondod? A már jóváírt tokenek megmaradnak.')) return;
            await api('/api/subscription', { method: 'DELETE' }).catch(() => {});
            setSub(null);
          }}>Lemondás</button>
        </div>
      ) : (
        <div className="cards">
          {PLANS.map((p) => (
            <div className="card" key={p.id} style={{ textAlign: 'center' }}>
              <div className="k">{p.label}</div>
              <div className="v" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {p.tokensPerMonth} <IconCoin size={18} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>havonta</div>
              <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
                setBusy(true); setNotice('');
                try {
                  const d = await api<{ url?: string; balance?: number; mock?: boolean }>('/api/subscription', {
                    method: 'POST', body: JSON.stringify({ planId: p.id }),
                  });
                  if (d.url) { location.href = d.url; return; }
                  setNotice(`Előfizetés aktív (teszt-mód) — +${p.tokensPerMonth} token jóváírva.`);
                  api<{ subscription: Sub | null }>('/api/subscription').then((r) => setSub(r.subscription)).catch(() => {});
                  load(true).catch(() => {});
                } catch { setNotice('Előfizetés sikertelen.'); }
                finally { setBusy(false); }
              }}>
                ${(p.priceCents / 100).toFixed(0)}/hó — előfizetek
              </button>
            </div>
          ))}
        </div>
      )}

      <h2>Promóciós kód</h2>
      <div className="row" style={{ marginBottom: 20 }}>
        <input className="input" style={{ width: 220 }} placeholder="pl. TL1A2B3C"
          value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
        <button className="btn sm" disabled={busy || !promo} onClick={async () => {
          setBusy(true); setNotice('');
          try {
            const d = await api<{ balance: number; tokens: number }>('/api/wallet/promo', {
              method: 'POST', body: JSON.stringify({ code: promo }),
            });
            setNotice(`Kód beváltva: +${d.tokens} token!`);
            setPromo('');
            setW((prev) => prev ? { ...prev, balance: d.balance } : prev);
            load(true).catch(() => {});
          } catch (e) {
            const msg = (e as Error).message;
            setNotice(msg === 'already_redeemed' ? 'Ezt a kódot már beváltottad.'
              : msg === 'invalid_code' ? 'Érvénytelen kód.'
              : msg === 'code_expired' || msg === 'code_exhausted' ? 'Ez a kód már nem érvényes.'
              : 'Beváltás sikertelen.');
          } finally { setBusy(false); }
        }}>Beváltás</button>
      </div>

      <h2>Költési előzmények</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <select className="input" style={{ width: 220 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">minden típus</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!txs.length ? <p className="muted">Nincs tranzakció.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Mikor</th><th>Típus</th><th>Leírás</th><th>Token</th><th>Egyenleg utána</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="muted mono">{fmtDate(t.createdAt)}</td>
                  <td><span className={`badge ${t.amount >= 0 ? 'credit' : 'debit'}`}>{TYPE_LABEL[t.type] || t.type}</span></td>
                  <td>{t.description}</td>
                  <td className={t.amount >= 0 ? 'amt-pos' : 'amt-neg'}>{t.amount >= 0 ? `+${t.amount}` : t.amount}</td>
                  <td className="mono">{t.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="pager">
          <button className="btn ghost sm" onClick={() => load(false, cursor)}>További betöltése…</button>
        </div>
      )}
    </div>
  );
}
