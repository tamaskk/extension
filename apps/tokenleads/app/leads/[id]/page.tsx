'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { api, pushRecent, NotEnoughTokens, ApiError } from '@/lib/clientApi';
import { LeadItem, CRM_STATUS_LABELS as CRM_LABELS } from '@/lib/leadShared';
import { Pricing } from '@/lib/pricingShared';
import { IconCoin, IconPhone, IconMail, IconGlobe, IconSparkles } from '@/components/Icons';

interface Meta { note: string; status: string; tags: string[]; }
interface Draft { subject: string; body: string; source: string; createdAt?: string; }

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<LeadItem | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [similar, setSimilar] = useState<LeadItem[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [aiOn, setAiOn] = useState(true);
  const [sender, setSender] = useState({ senderName: '', senderPitch: '' });
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api<{ lead: LeadItem }>(`/api/leads/${id}`).then((d) => {
      setLead(d.lead);
      if (d.lead.unlocked.lead) pushRecent({ id, name: d.lead.name, city: d.lead.city, at: Date.now() });
    }).catch(() => setErr('Lead nem található.'));
    fetch('/api/pricing').then((r) => r.json()).then((d) => d?.ok && setPricing(d.pricing)).catch(() => {});
    api<{ items: LeadItem[] }>(`/api/leads/${id}/similar`).then((d) => setSimilar(d.items)).catch(() => {});
    api<{ meta: Meta | null }>(`/api/leads/${id}/meta`).then((d) => d.meta && setMeta(d.meta)).catch(() => {});
    api<{ drafts: Draft[]; aiEnabled: boolean }>(`/api/leads/${id}/ai-email`).then((d) => {
      setDrafts(d.drafts); setAiOn(d.aiEnabled);
    }).catch(() => {});
    try {
      setSender({
        senderName: localStorage.getItem('tl_sender_name') || '',
        senderPitch: localStorage.getItem('tl_sender_pitch') || '',
      });
    } catch { /* no storage */ }
  }, [id]);

  async function unlock(kind: 'unlock' | 'contact') {
    setBusy(kind); setErr('');
    try {
      const d = await api<{ lead: LeadItem; noContact?: boolean }>(`/api/leads/${id}/${kind}`, { method: 'POST' });
      setLead(d.lead);
      if (d.lead.unlocked.lead) pushRecent({ id, name: d.lead.name, city: d.lead.city, at: Date.now() });
      if (d.noContact) setNotice('Ehhez a leadhez nincs rögzített elérhetőség — a feloldás ingyenes volt.');
    } catch (e) {
      if (e instanceof NotEnoughTokens) setErr(`Nincs elég token (kell: ${e.required}, van: ${e.balance}).`);
      else if ((e as ApiError).status === 409) setErr('Előbb a leadet kell feloldani.');
      else setErr('Hiba történt, próbáld újra.');
    } finally {
      setBusy('');
    }
  }

  async function saveMeta(patch: Partial<Meta>) {
    const next = { note: meta?.note || '', status: meta?.status || 'new', tags: meta?.tags || [], ...patch };
    setMeta(next);
    api(`/api/leads/${id}/meta`, { method: 'PUT', body: JSON.stringify(next) }).catch(() => {});
  }

  async function generateEmail() {
    setBusy('ai'); setErr(''); setNotice('');
    try {
      localStorage.setItem('tl_sender_name', sender.senderName);
      localStorage.setItem('tl_sender_pitch', sender.senderPitch);
    } catch { /* no storage */ }
    try {
      const d = await api<{ draft: Draft; charged: number }>(`/api/leads/${id}/ai-email`, {
        method: 'POST', body: JSON.stringify(sender),
      });
      setDrafts((arr) => [d.draft, ...arr]);
      setNotice(d.draft.source === 'template'
        ? `Sablon-alapú piszkozat kész (${d.charged} token) — AI kulcs beállításával személyre szabott szöveget kapsz.`
        : `AI piszkozat kész (${d.charged} token).`);
    } catch (e) {
      if (e instanceof NotEnoughTokens) setErr(`Nincs elég token (kell: ${e.required}).`);
      else if ((e as ApiError).status === 503) setErr('Az AI szolgáltatás átmenetileg nem elérhető — a tokent visszatérítettük.');
      else setErr('Generálás sikertelen.');
    } finally {
      setBusy('');
    }
  }

  async function report() {
    const reason = prompt('Mi a probléma az adattal? (pl. nem élő telefonszám, rossz e-mail)');
    if (!reason) return;
    try {
      await api(`/api/leads/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNotice('Köszönjük a jelzést — az admin átnézi, és jogos panasz esetén visszatérítjük a tokent.');
    } catch (e) {
      setErr((e as ApiError).status === 409 ? 'Ezt a leadet már bejelentetted, vagy nincs feloldva a kontaktja.' : 'Bejelentés sikertelen.');
    }
  }

  if (!lead) return <div>{err ? <div className="notice err">{err}</div> : <p className="muted">Betöltés…</p>}</div>;

  return (
    <div>
      <p><Link href="/leads">← vissza a keresőhöz</Link></p>
      <h1 style={{ fontSize: 22, margin: '0 0 2px' }}>{lead.unlocked.lead ? lead.name : <span className="masked">{lead.name}</span>}</h1>
      <p className="sub">{lead.category}{lead.city ? ` · ${lead.city}` : ''}</p>

      {err && <div className="notice err" role="alert">{err}</div>}
      {notice && <div className="notice ok">{notice}</div>}

      <div className="cards">
        <div className="card"><div className="k">Értékelés</div><div className="v">{lead.rating != null ? `★ ${lead.rating}` : '—'}</div></div>
        <div className="card"><div className="k">Vélemények</div><div className="v">{lead.reviewCount ?? '—'}</div></div>
        <div className="card"><div className="k">Lead score</div><div className="v">{lead.leadScore ?? '—'}</div></div>
        <div className="card"><div className="k">Státusz</div><div className="v" style={{ fontSize: 15 }}>
          {lead.unlocked.contact ? <span className="badge open">kontakt feloldva</span>
            : lead.unlocked.lead ? <span className="badge open">lead feloldva</span>
            : <span className="badge locked">zárolt</span>}
        </div></div>
      </div>

      {!lead.unlocked.lead && (
        <div className="section" style={{ textAlign: 'center' }}>
          <p>A teljes cégnév, cím és az AI-elemzés zárolva van.</p>
          <button className="btn" disabled={!!busy} onClick={() => unlock('unlock')}>
            Lead feloldása · {pricing?.LEAD_UNLOCK_COST ?? '…'} <IconCoin size={15} />
          </button>
        </div>
      )}

      {lead.unlocked.lead && (
        <div className="grid2">
          <div className="section">
            <h2 style={{ marginTop: 0 }}>Cégadatok</h2>
            <div className="kv">
              <span className="k">Cím</span><span>{lead.address || '—'}</span>
              <span className="k">Google Maps</span><span>{lead.mapsUrl ? <a href={lead.mapsUrl} target="_blank" rel="noreferrer">megnyitás ↗</a> : '—'}</span>
              <span className="k">Weboldal státusz</span><span>{lead.websiteStatus || '—'}</span>
              <span className="k">Pitch ötlet</span><span>{lead.topPitch || '—'}</span>
            </div>
            {(lead.aiSummary || lead.aiPitch) && (
              <>
                <h2>AI elemzés</h2>
                <div className="kv">
                  {lead.aiSummary && <><span className="k">Összefoglaló</span><span>{lead.aiSummary}</span></>}
                  {lead.aiPainPoints && <><span className="k">Fájdalompontok</span><span>{lead.aiPainPoints}</span></>}
                  {lead.aiAdvantages && <><span className="k">Előnyök</span><span>{lead.aiAdvantages}</span></>}
                  {lead.aiPitch && <><span className="k">Pitch</span><span>{lead.aiPitch}</span></>}
                </div>
              </>
            )}
          </div>

          <div className="section">
            <h2 style={{ marginTop: 0 }}>Saját CRM</h2>
            <div className="field">
              <label>Pipeline státusz</label>
              <select className="input" value={meta?.status || 'new'} onChange={(e) => saveMeta({ status: e.target.value })}>
                {Object.entries(CRM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Jegyzet</label>
              <textarea className="input" placeholder="pl. kedd 10-kor visszahívni…"
                defaultValue={meta?.note || ''} onBlur={(e) => saveMeta({ note: e.target.value })} />
            </div>
            <div className="field">
              <label>Címkék (vesszővel)</label>
              <input className="input" defaultValue={(meta?.tags || []).join(', ')}
                onBlur={(e) => saveMeta({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
            </div>
          </div>
        </div>
      )}

      {lead.unlocked.lead && !lead.unlocked.contact && (
        <div className="section" style={{ textAlign: 'center' }}>
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            Elérhetőségek zárolva:
            {lead.hasPhone && <span className="badge neutral" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><IconPhone size={12} /> telefon</span>}
            {lead.hasEmail && <span className="badge neutral" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><IconMail size={12} /> e-mail</span>}
            {lead.hasWebsite && <span className="badge neutral" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><IconGlobe size={12} /> weboldal</span>}
            {!lead.hasPhone && !lead.hasEmail && !lead.hasWebsite && <span className="muted">ehhez a leadhez nincs rögzített elérhetőség — a feloldás ingyenes</span>}
          </p>
          <button className="btn" disabled={!!busy} onClick={() => unlock('contact')}>
            Kontakt feloldása · {(!lead.hasPhone && !lead.hasEmail && !lead.hasWebsite) ? 0 : pricing?.CONTACT_UNLOCK_COST ?? '…'} <IconCoin size={15} />
          </button>
        </div>
      )}

      {lead.unlocked.contact && (
        <div className="section">
          <div className="card-h">
            <h2 style={{ margin: 0 }}>Elérhetőségek</h2>
            <button className="btn ghost sm" onClick={report}>Hibás adat jelentése</button>
          </div>
          <div className="kv">
            <span className="k">Telefon</span><span>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</span>
            <span className="k">E-mail</span><span>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</span>
            <span className="k">Weboldal</span><span>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : '—'}</span>
          </div>
        </div>
      )}

      {lead.unlocked.lead && (
        <div className="section">
          <div className="card-h">
            <h2 style={{ margin: 0 }}><IconSparkles size={15} /> AI outreach e-mail</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {aiOn ? 'Claude-alapú generálás' : 'Sablon-mód (nincs AI kulcs beállítva)'}
            </span>
          </div>
          <div className="filter-grid" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>A neved / céged</label>
              <input className="input" placeholder="pl. Kiss Péter — WebStudio"
                value={sender.senderName} onChange={(e) => setSender({ ...sender, senderName: e.target.value })} />
            </div>
            <div className="field">
              <label>Amit kínálsz</label>
              <input className="input" placeholder="pl. modern weboldalak helyi vállalkozásoknak"
                value={sender.senderPitch} onChange={(e) => setSender({ ...sender, senderPitch: e.target.value })} />
            </div>
          </div>
          <button className="btn" disabled={busy === 'ai'} onClick={generateEmail}>
            {busy === 'ai' ? 'Generálás…' : <>E-mail generálása · {pricing?.AI_EMAIL_COST ?? 8} <IconCoin size={14} /></>}
          </button>
          {drafts.map((d, i) => (
            <div key={i} className="card" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b>{d.subject}</b>
                <span className={`badge ${d.source === 'ai' ? 'credit' : 'neutral'}`}>{d.source === 'ai' ? 'AI' : 'sablon'}</span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13.5 }}>{d.body}</p>
              <div style={{ marginTop: 10 }}>
                <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`)}>Másolás</button>
                {lead.email && (
                  <a className="btn ghost sm" style={{ marginLeft: 8 }}
                    href={`mailto:${lead.email}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`}>
                    Küldés e-mailben
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {similar.length > 0 && (
        <div className="section">
          <h2 style={{ marginTop: 0 }}>Hasonló leadek {lead.city ? `— ${lead.category}` : ''}</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Cég</th><th>Hely</th><th>Értékelés</th><th>Score</th><th></th></tr></thead>
              <tbody>
                {similar.map((l) => (
                  <tr key={l.id}>
                    <td>{l.unlocked.lead ? <Link href={`/leads/${l.id}`}><b>{l.name}</b></Link> : <span className="masked">{l.name}</span>}</td>
                    <td className="muted">{l.city || '—'}</td>
                    <td className="mono">{l.rating != null ? `★ ${l.rating}` : '—'}</td>
                    <td className="mono">{l.leadScore ?? '—'}</td>
                    <td><Link href={`/leads/${l.id}`} className="muted" style={{ fontSize: 12 }}>megnyitás →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
