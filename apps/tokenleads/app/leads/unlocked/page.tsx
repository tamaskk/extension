'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile } from '@/lib/clientApi';
import { LeadItem, CRM_STATUS_LABELS as CRM_LABELS } from '@/lib/leadShared';
import { IconPhone, IconMail, IconGlobe } from '@/components/Icons';

type Row = LeadItem & { meta?: { note: string; status: string; tags: string[] } | null };

export default function UnlockedPage() {
  const [items, setItems] = useState<Row[] | null>(null);
  const [onlyContact, setOnlyContact] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api<{ items: Row[] }>(`/api/leads/unlocked${onlyContact ? '?scope=contact' : ''}`)
      .then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [onlyContact]);

  async function setStatus(id: string, status: string) {
    setItems((arr) => arr ? arr.map((i) => (i.id === id ? { ...i, meta: { note: i.meta?.note || '', tags: i.meta?.tags || [], status } } : i)) : arr);
    api(`/api/leads/${id}/meta`, { method: 'PUT', body: JSON.stringify({ status }) }).catch(() => {});
  }

  const visible = (items || []).filter((i) => !statusFilter || (i.meta?.status || 'new') === statusFilter);

  return (
    <div>
      <p className="sub">Minden, amit már feloldottál — újra megnyitni ingyenes, örökre a tiéd. Státusszal és jegyzettel követheted a pipeline-od.</p>
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <label className="check">
          <input type="checkbox" checked={onlyContact} onChange={(e) => setOnlyContact(e.target.checked)} />
          csak ahol a kontakt is fel van oldva
        </label>
        <select className="input" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">minden státusz</option>
          {Object.entries(CRM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => downloadFile('/api/leads/export').catch(() => {})}>
          CSV export (ingyenes)
        </button>
      </div>

      {items === null ? <p className="muted">Betöltés…</p> : !visible.length ? <p className="muted">Nincs találat.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Cég</th><th>Kategória</th><th>Hely</th><th>Kontakt</th><th>Pipeline</th><th>Jegyzet</th></tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/leads/${l.id}`}><b>{l.name}</b></Link></td>
                  <td>{l.category || <span className="muted">—</span>}</td>
                  <td className="muted">{l.city || '—'}</td>
                  <td>
                    {l.unlocked.contact ? (
                      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                        {l.phone && <a href={`tel:${l.phone}`} title={l.phone}><IconPhone size={14} /></a>}
                        {l.email && <a href={`mailto:${l.email}`} title={l.email}><IconMail size={14} /></a>}
                        {l.website && <a href={l.website} target="_blank" rel="noreferrer" title={l.website}><IconGlobe size={14} /></a>}
                        {!l.phone && !l.email && !l.website && <span className="muted">nincs adat</span>}
                      </span>
                    ) : <span className="badge locked">zárolt</span>}
                  </td>
                  <td>
                    <select className="input" style={{ width: 130, padding: '5px 8px' }}
                      value={l.meta?.status || 'new'} onChange={(e) => setStatus(l.id, e.target.value)}>
                      {Object.entries(CRM_LABELS).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                    </select>
                  </td>
                  <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={l.meta?.note || ''}>
                    {l.meta?.note || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
