'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, NotEnoughTokens } from '@/lib/clientApi';
import { LeadItem } from '@/lib/leadShared';
import { Pricing } from '@/lib/pricingShared';
import { IconCoin, IconPhone, IconMail, IconGlobe } from './Icons';

// Shared results table: masked rows + unlock buttons. Parent owns the item
// list; we patch rows in place through onUpdate as unlocks come back.
export default function LeadTable({ items, pricing, onUpdate }: {
  items: LeadItem[];
  pricing: Pricing | null;
  onUpdate: (lead: LeadItem) => void;
}) {
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function unlock(id: string, kind: 'unlock' | 'contact') {
    setBusyId(id + kind); setErr('');
    try {
      const d = await api<{ lead: LeadItem }>(`/api/leads/${id}/${kind}`, { method: 'POST' });
      onUpdate(d.lead);
    } catch (e) {
      if (e instanceof NotEnoughTokens) {
        setErr(`Nincs elég token (kell: ${e.required}, van: ${e.balance}). Tölts fel az Egyenleg oldalon.`);
        setTimeout(() => router.push('/wallet'), 1800);
      } else setErr('Hiba a feloldásnál, próbáld újra.');
    } finally {
      setBusyId('');
    }
  }

  if (!items.length) return <p className="muted">Nincs találat.</p>;

  return (
    <>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Cég</th><th>Kategória</th><th>Hely</th><th>Értékelés</th>
              <th>Score</th><th>Kontakt</th><th style={{ width: 240 }}>Művelet</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.unlocked.lead
                    ? <Link href={`/leads/${l.id}`}><b>{l.name}</b></Link>
                    : <span className="masked">{l.name}</span>}
                </td>
                <td>{l.category || <span className="muted">—</span>}</td>
                <td className="muted">{l.city || '—'}</td>
                <td className="mono">{l.rating != null ? `★ ${l.rating} (${l.reviewCount ?? 0})` : <span className="muted">—</span>}</td>
                <td className="mono">{l.leadScore ?? <span className="muted">—</span>}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 6, color: 'var(--muted)' }}>
                    {l.hasPhone && <IconPhone size={15} />}
                    {l.hasEmail && <IconMail size={15} />}
                    {l.hasWebsite && <IconGlobe size={15} />}
                    {!l.hasPhone && !l.hasEmail && !l.hasWebsite && '—'}
                  </span>
                </td>
                <td>
                  {!l.unlocked.lead && (
                    <button className="btn sm" disabled={busyId === l.id + 'unlock'} onClick={() => unlock(l.id, 'unlock')}>
                      Feloldás · {pricing?.LEAD_UNLOCK_COST ?? '…'} <IconCoin size={13} />
                    </button>
                  )}
                  {l.unlocked.lead && !l.unlocked.contact && (
                    <button className="btn ghost sm" disabled={busyId === l.id + 'contact'} onClick={() => unlock(l.id, 'contact')}>
                      Kontakt · {pricing?.CONTACT_UNLOCK_COST ?? '…'} <IconCoin size={13} />
                    </button>
                  )}
                  {l.unlocked.contact && <span className="badge open">feloldva</span>}
                  {' '}
                  {l.unlocked.lead && <Link href={`/leads/${l.id}`} className="muted" style={{ fontSize: 12 }}>részletek</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
