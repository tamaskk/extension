'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/lib/clientApi';
import { LeadItem } from '@/lib/leadShared';
import { IconCoin, IconTrendUp, IconWallet, IconUnlock, IconPhone, IconSearch, IconArrowUp, IconArrowDown } from '@/components/Icons';
import SpendChart, { DayPoint } from '@/components/SpendChart';

interface WalletResp { balance: number; lifetimeGranted: number; lifetimeSpent: number; leadUnlocks: number; contactUnlocks: number; }
interface Tx { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: string; }

import { TYPE_LABEL } from '@/lib/txShared';
import { getRecent, RecentLead } from '@/lib/clientApi';

function StatCard({ icon, label, value, sub, delta }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub: string; delta?: { up: boolean; text: string };
}) {
  return (
    <div className="card">
      <div className="stat-head">
        <span className="stat-ic">{icon}</span>
        <span className="k">{label}</span>
      </div>
      <div className="v">{value}</div>
      <div className="stat-sub">
        {sub}
        {delta && (
          <span className={`delta ${delta.up ? 'up' : 'down'}`}>
            {delta.up ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />} {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [w, setW] = useState<WalletResp | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [recent, setRecent] = useState<LeadItem[]>([]);
  const [viewed, setViewed] = useState<RecentLead[]>([]);

  useEffect(() => {
    api<WalletResp>('/api/wallet').then(setW).catch(() => {});
    api<{ items: Tx[] }>('/api/wallet/transactions').then((d) => setTxs(d.items)).catch(() => {});
    api<{ items: LeadItem[] }>('/api/leads/unlocked').then((d) => setRecent(d.items.slice(0, 5))).catch(() => {});
    setViewed(getRecent());
  }, []);

  // Daily spend, last 14 days, from the newest ledger page.
  const chart: DayPoint[] = useMemo(() => {
    const days: DayPoint[] = [];
    const byKey = new Map<string, number>();
    for (const t of txs) {
      if (t.amount >= 0) continue;
      const k = t.createdAt.slice(0, 10);
      byKey.set(k, (byKey.get(k) || 0) - t.amount);
    }
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      days.push({ label: `${d.getMonth() + 1}.${d.getDate()}.`, value: byKey.get(k) || 0 });
    }
    return days;
  }, [txs]);

  const spent7 = useMemo(() => chart.slice(7).reduce((s, d) => s + d.value, 0), [chart]);

  return (
    <>
      <div className="cards">
        <StatCard icon={<IconCoin size={19} />} label="Egyenleg" value={w ? w.balance : '…'} sub="token" />
        <StatCard icon={<IconTrendUp size={19} />} label="Összes kapott" value={w ? `+${w.lifetimeGranted}` : '…'} sub="token, összesen" />
        <StatCard icon={<IconWallet size={19} />} label="Összes elköltött" value={w ? `−${w.lifetimeSpent}` : '…'} sub="utolsó 7 nap"
          delta={w ? { up: false, text: `${spent7}` } : undefined} />
        <StatCard icon={<IconUnlock size={19} />} label="Feloldott lead" value={w ? w.leadUnlocks : '…'} sub="örökre elérhető" />
        <StatCard icon={<IconPhone size={19} />} label="Feloldott kontakt" value={w ? w.contactUnlocks : '…'} sub="telefon · e-mail · web" />
      </div>

      {viewed.length > 0 && (
        <div className="row" style={{ marginBottom: 18, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Nemrég megtekintett:</span>
          {viewed.slice(0, 5).map((v) => (
            <Link key={v.id} href={`/leads/${v.id}`} className="chip" style={{ fontWeight: 600, fontSize: 12.5, padding: '5px 12px' }}>
              {v.name}
            </Link>
          ))}
        </div>
      )}

      <div className="section">
        <div className="card-h">
          <h2>Token költés — utolsó 14 nap</h2>
          <Link href="/wallet" className="btn ghost sm">Teljes előzmény</Link>
        </div>
        <SpendChart data={chart} />
      </div>

      <div className="grid2">
        <div>
          <div className="card-h" style={{ marginTop: 6 }}>
            <h2>Legutóbbi mozgások</h2>
            <Link href="/wallet" className="muted" style={{ fontSize: 12.5 }}>összes →</Link>
          </div>
          {!txs.length ? <p className="muted">Még nincs tranzakció.</p> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Mikor</th><th>Művelet</th><th>Token</th></tr></thead>
                <tbody>
                  {txs.slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td className="muted mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.createdAt)}</td>
                      <td>
                        <span className={`badge ${t.amount >= 0 ? 'credit' : 'neutral'}`}>{TYPE_LABEL[t.type] || t.type}</span>
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12.5 }}>{t.description}</span>
                      </td>
                      <td className={t.amount >= 0 ? 'amt-pos' : 'amt-neg'}>{t.amount >= 0 ? `+${t.amount}` : t.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="card-h" style={{ marginTop: 6 }}>
            <h2>Legutóbb feloldott leadek</h2>
            <Link href="/leads/unlocked" className="muted" style={{ fontSize: 12.5 }}>összes →</Link>
          </div>
          {!recent.length ? (
            <div className="section" style={{ textAlign: 'center' }}>
              <p className="muted">Még nincs feloldott leaded.</p>
              <Link href="/leads" className="btn sm"><IconSearch size={15} /> Keresés indítása</Link>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Cég</th><th>Hely</th><th>Státusz</th></tr></thead>
                <tbody>
                  {recent.map((l) => (
                    <tr key={l.id}>
                      <td><Link href={`/leads/${l.id}`}><b>{l.name}</b></Link></td>
                      <td className="muted">{l.city || '—'}</td>
                      <td>
                        {l.unlocked.contact
                          ? <span className="badge open">kontakt</span>
                          : <span className="badge info">lead</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
