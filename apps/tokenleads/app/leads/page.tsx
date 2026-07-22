'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile, NotEnoughTokens, RateLimited, NotVerified } from '@/lib/clientApi';
import { LeadItem } from '@/lib/leadShared';
import { Pricing } from '@/lib/pricingShared';
import LeadTable from '@/components/LeadTable';
import { IconCoin, IconSearch, IconBookmark } from '@/components/Icons';

interface SearchResp {
  items: LeadItem[]; total: number; page: number; pages: number;
  charged: number; cost: number;
}
interface Facets { categories: { v: string; n: number }[]; cities: { v: string; n: number }[]; total: number; }
interface SavedItem { id: string; name: string; filters: Record<string, unknown>; alert: string; lastRunAt: string | null; lastCount: number; }

const RATING_OPTS = [
  { v: '', label: 'bármilyen' }, { v: '3', label: '★ 3.0 felett' }, { v: '3.5', label: '★ 3.5 felett' },
  { v: '4', label: '★ 4.0 felett' }, { v: '4.5', label: '★ 4.5 felett' }, { v: '4.8', label: '★ 4.8 felett' },
];
const REVIEW_OPTS = [
  { v: '', label: 'bármennyi' }, { v: '10', label: 'legalább 10' }, { v: '25', label: 'legalább 25' },
  { v: '50', label: 'legalább 50' }, { v: '100', label: 'legalább 100' }, { v: '250', label: 'legalább 250' },
];
const TEMP_OPTS = [
  { v: '', label: 'mind' }, { v: 'HOT', label: 'Forró (HOT)' }, { v: 'WARM', label: 'Meleg (WARM)' }, { v: 'COLD', label: 'Hideg (COLD)' },
];
const WEBSITE_OPTS = [
  { v: '', label: 'mindegy' }, { v: 'NO_WEBSITE', label: 'Nincs weboldala' }, { v: 'FACEBOOK_ONLY', label: 'Csak Facebook' },
  { v: 'INSTAGRAM_ONLY', label: 'Csak Instagram' }, { v: 'HAS_WEBSITE', label: 'Van weboldala' },
];

const EMPTY = {
  q: '', category: '', city: '', minRating: '', minReviews: '',
  temperature: '', websiteStatus: '', hasEmail: false, hasPhone: false,
};
type Filters = typeof EMPTY;

function filtersToBody(f: Filters, page: number) {
  return {
    q: f.q || undefined, category: f.category || undefined, city: f.city || undefined,
    minRating: f.minRating || undefined, minReviews: f.minReviews || undefined,
    temperature: f.temperature || undefined, websiteStatus: f.websiteStatus || undefined,
    hasEmail: f.hasEmail || undefined, hasPhone: f.hasPhone || undefined, page,
  };
}

export default function LeadsPage() {
  const [f, setF] = useState<Filters>({ ...EMPTY });
  const [facets, setFacets] = useState<Facets | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [res, setRes] = useState<SearchResp | null>(null);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const fRef = useRef(f);
  fRef.current = f;
  const resRef = useRef(res);
  resRef.current = res;
  // The filters that produced the currently-displayed `res` — export must use
  // these, not the live form state, or its grant-hash won't match the paid page.
  const resFiltersRef = useRef<Filters>(EMPTY);

  useEffect(() => {
    fetch('/api/pricing').then((r) => r.json()).then((d) => d?.ok && setPricing(d.pricing)).catch(() => {});
    api<Facets>('/api/leads/facets').then(setFacets).catch(() => {});
    api<{ items: SavedItem[] }>('/api/searches').then((d) => setSaved(d.items)).catch(() => {});
  }, []);

  // Dependent facets: whenever any filter changes, refresh the dropdown counts
  // so category/city numbers reflect the current selection (debounced to keep
  // rapid toggling off the source DB). Signature-gated so identical states skip.
  const facetSig = JSON.stringify([f.q, f.category, f.city, f.minRating, f.minReviews, f.temperature, f.websiteStatus, f.hasEmail, f.hasPhone]);
  useEffect(() => {
    const active = f.q || f.category || f.city || f.minRating || f.minReviews || f.temperature || f.websiteStatus || f.hasEmail || f.hasPhone;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filtersToBody(fRef.current, 1))) {
        if (v !== undefined && k !== 'page') params.set(k, v === true ? '1' : String(v));
      }
      api<Facets>(`/api/leads/facets${active ? `?${params.toString()}` : ''}`).then(setFacets).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [facetSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(async (page = 1, override?: Filters) => {
    const filters = override ?? fRef.current;
    setBusy(true); setErr(''); setNotice('');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filtersToBody(filters, page))) {
      if (v !== undefined) params.set(k, v === true ? '1' : String(v));
    }
    try {
      const d = await api<SearchResp>(`/api/leads/search?${params.toString()}`);
      setRes(d);
      resFiltersRef.current = filters;
      setNotice(d.charged > 0
        ? `${d.charged} token levonva ezért az oldalért — ugyanez a keresés 24 óráig ingyen újranyitható.`
        : 'Ez az oldal már ki volt fizetve (24 órás keresési jóváírás) — nem vontunk le tokent.');
    } catch (e) {
      if (e instanceof NotEnoughTokens) setErr(`Nincs elég token a kereséshez (kell: ${e.required}, van: ${e.balance}).`);
      else if (e instanceof RateLimited) {
        const mins = Math.round(e.retryAfter / 60);
        // Daily quota (long retryAfter) reads differently from the per-minute limiter.
        setErr(mins > 5 ? `Elérted a napi keresési kereted — holnap (kb. ${mins < 90 ? mins + ' perc' : Math.round(mins / 60) + ' óra'} múlva) újraindul.` : `Túl sok kérés — próbáld újra ${e.retryAfter} mp múlva.`);
      }
      else if (e instanceof NotVerified) setErr('Előbb erősítsd meg az e-mail címed (lásd a sárga sávot fent).');
      else setErr('Hiba a keresésnél, próbáld újra.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Keyboard: "/" focuses the keyword box, ←/→ pages (outside inputs).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); qRef.current?.focus(); }
      const r = resRef.current;
      if (!r) return;
      if (e.key === 'ArrowRight' && r.page < r.pages) void search(r.page + 1);
      if (e.key === 'ArrowLeft' && r.page > 1) void search(r.page - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  function patch(lead: LeadItem) {
    setRes((r) => r ? { ...r, items: r.items.map((i) => (i.id === lead.id ? lead : i)) } : r);
  }
  function patchMany(leads: LeadItem[]) {
    const byId = new Map(leads.map((l) => [l.id, l]));
    setRes((r) => r ? { ...r, items: r.items.map((i) => byId.get(i.id) || i) } : r);
  }

  async function saveSearch() {
    const label = [f.q, f.category, f.city, f.websiteStatus && WEBSITE_OPTS.find((o) => o.v === f.websiteStatus)?.label]
      .filter(Boolean).join(' · ') || 'Mentett keresés';
    const name = prompt('A mentett keresés neve:', label);
    if (!name) return;
    try {
      await api('/api/searches', { method: 'POST', body: JSON.stringify({ name, filters: filtersToBody(f, 1), alert: 'daily' }) });
      const d = await api<{ items: SavedItem[] }>('/api/searches');
      setSaved(d.items);
      setNotice('Keresés elmentve — naponta e-mailt kapsz, ha új lead érkezik rá (radar).');
    } catch (e) {
      setErr((e as Error).message === 'this filter combination is already saved' ? 'Ez a szűrő-kombináció már el van mentve.' : 'Mentés sikertelen.');
    }
  }

  function runSaved(s: SavedItem) {
    const nf: Filters = { ...EMPTY };
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) {
      const v = s.filters[k];
      if (v === undefined || v === null) continue;
      if (k === 'hasEmail' || k === 'hasPhone') (nf[k] as boolean) = !!v;
      else (nf[k] as string) = String(v);
    }
    setF(nf);
    void search(1, nf);
  }

  async function setAlert(s: SavedItem, alert: string) {
    await api(`/api/searches/${s.id}`, { method: 'PUT', body: JSON.stringify({ alert }) }).catch(() => {});
    setSaved((arr) => arr.map((x) => (x.id === s.id ? { ...x, alert } : x)));
  }

  async function deleteSaved(id: string) {
    await api(`/api/searches/${id}`, { method: 'DELETE' }).catch(() => {});
    setSaved((arr) => arr.filter((x) => x.id !== id));
  }

  async function exportPage() {
    if (!res) return;
    try {
      await downloadFile('/api/leads/export', { method: 'POST', body: JSON.stringify(filtersToBody(resFiltersRef.current, res.page)) });
      setNotice(`CSV letöltve (${pricing?.EXPORT_PAGE_COST ?? 5} token).`);
    } catch (e) {
      if (e instanceof NotEnoughTokens) setErr('Nincs elég token az exporthoz.');
      else if (e instanceof NotVerified) setErr('Előbb erősítsd meg az e-mail címed az exporthoz.');
      else if (e instanceof RateLimited) setErr('Túl sok export egymás után — várj egy percet.');
      else setErr('Export sikertelen — előbb futtasd le a keresést (az export a kifizetett oldalhoz kötött).');
    }
  }

  async function bulkUnlock() {
    if (!res) return;
    const locked = res.items.filter((i) => !i.unlocked.lead);
    if (!locked.length) return;
    const full = locked.length * (pricing?.LEAD_UNLOCK_COST ?? 2);
    const disc = Math.ceil(full * (100 - (pricing?.BULK_DISCOUNT_PCT ?? 20)) / 100);
    if (!confirm(`${locked.length} zárolt lead feloldása ${disc} tokenért (${full} helyett, ${pricing?.BULK_DISCOUNT_PCT ?? 20}% kedvezmény)?`)) return;
    setBusy(true); setErr('');
    try {
      const d = await api<{ items: LeadItem[]; charged: number }>('/api/leads/bulk-unlock', {
        method: 'POST', body: JSON.stringify({ ids: locked.map((l) => l.id) }),
      });
      patchMany(d.items);
      setNotice(`${locked.length} lead feloldva — ${d.charged} token.`);
    } catch (e) {
      if (e instanceof NotEnoughTokens) setErr(`Nincs elég token (kell: ${e.required}, van: ${e.balance}).`);
      else setErr('Csoportos feloldás sikertelen.');
    } finally {
      setBusy(false);
    }
  }

  const activeCount = [f.q, f.category, f.city, f.minRating, f.minReviews, f.temperature, f.websiteStatus]
    .filter(Boolean).length + (f.hasEmail ? 1 : 0) + (f.hasPhone ? 1 : 0);
  const facetsFiltered = activeCount > 0;
  const lockedCount = res ? res.items.filter((i) => !i.unlocked.lead).length : 0;

  return (
    <div>
      <p className="sub">
        Egy keresés-oldal ára {pricing?.SEARCH_COST ?? '…'} token (20 találat) — ugyanaz a lekérés 24 óráig ingyen ismételhető.
        {facets ? (facetsFiltered
          ? ` A jelenlegi szűrőkre ${facets.total.toLocaleString('hu-HU')} lead illik.`
          : ` Az adatbázisban jelenleg ${facets.total.toLocaleString('hu-HU')} lead van.`) : ''}
        {' '}Tipp: <kbd>/</kbd> a keresőmezőhöz, <kbd>←</kbd>/<kbd>→</kbd> a lapozáshoz.
      </p>

      {saved.length > 0 && (
        <div className="section" style={{ paddingBottom: 8 }}>
          <div className="card-h" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 14.5 }}><IconBookmark size={14} /> Mentett keresések (radar)</h2>
          </div>
          {saved.map((s) => (
            <div className="list-row" key={s.id}>
              <div className="grow">
                <div className="nm">{s.name}</div>
                <div className="ds">
                  {s.lastRunAt ? `utolsó radar: ${new Date(s.lastRunAt).toLocaleDateString('hu-HU')} · ${s.lastCount} új lead` : 'radar még nem futott'}
                </div>
              </div>
              <select className="input" style={{ width: 120 }} value={s.alert} onChange={(e) => setAlert(s, e.target.value)}
                title="E-mail értesítés új leadekről">
                <option value="off">nincs alert</option>
                <option value="daily">napi</option>
                <option value="weekly">heti</option>
              </select>
              <button className="btn ghost sm" onClick={() => runSaved(s)}>Futtatás</button>
              <button className="btn ghost sm" onClick={() => deleteSaved(s.id)} aria-label="Törlés">✕</button>
            </div>
          ))}
        </div>
      )}

      <form className="section" onSubmit={(e) => { e.preventDefault(); void search(1); }}>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="f-q">Kulcsszó (név vagy kategória)</label>
            <input id="f-q" ref={qRef} className="input" placeholder="pl. pizza, fodrász…"
              value={f.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-cat">Kategória</label>
            <select id="f-cat" className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">{facets ? 'összes kategória' : 'betöltés…'}</option>
              {f.category && !facets?.categories.some((c) => c.v === f.category) && (
                <option value={f.category}>{f.category}</option>
              )}
              {facets?.categories.map((c) => (
                <option key={c.v} value={c.v}>{c.v} ({c.n.toLocaleString('hu-HU')})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-city">Város</label>
            <select id="f-city" className="input" value={f.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">{facets ? 'összes város' : 'betöltés…'}</option>
              {f.city && !facets?.cities.some((c) => c.v === f.city) && (
                <option value={f.city}>{f.city}</option>
              )}
              {facets?.cities.map((c) => (
                <option key={c.v} value={c.v}>{c.v} ({c.n.toLocaleString('hu-HU')})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-rating">Min. értékelés</label>
            <select id="f-rating" className="input" value={f.minRating} onChange={(e) => set('minRating', e.target.value)}>
              {RATING_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-reviews">Vélemények száma</label>
            <select id="f-reviews" className="input" value={f.minReviews} onChange={(e) => set('minReviews', e.target.value)}>
              {REVIEW_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-temp">Lead-hőmérséklet</label>
            <select id="f-temp" className="input" value={f.temperature} onChange={(e) => set('temperature', e.target.value)}>
              {TEMP_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-web">Weboldal státusz</label>
            <select id="f-web" className="input" value={f.websiteStatus} onChange={(e) => set('websiteStatus', e.target.value)}>
              {WEBSITE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Elérhetőség</label>
            <div style={{ display: 'flex', gap: 14, paddingTop: 9 }}>
              <label className="check">
                <input type="checkbox" checked={f.hasEmail} onChange={(e) => set('hasEmail', e.target.checked)} /> van e-mail
              </label>
              <label className="check">
                <input type="checkbox" checked={f.hasPhone} onChange={(e) => set('hasPhone', e.target.checked)} /> van telefon
              </label>
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Keresés…' : <><IconSearch size={15} /> Keresés · {pricing?.SEARCH_COST ?? 1} <IconCoin size={14} /></>}
          </button>
          {activeCount > 0 && (
            <>
              <button type="button" className="btn ghost" onClick={saveSearch}>
                <IconBookmark size={14} /> Keresés mentése
              </button>
              <button type="button" className="btn ghost" onClick={() => setF({ ...EMPTY })}>
                Szűrők törlése ({activeCount})
              </button>
            </>
          )}
        </div>
      </form>

      {err && <div className="notice err" role="alert">{err}</div>}
      {notice && <div className="notice info">{notice}</div>}

      {res && (
        <>
          <div className="row" style={{ alignItems: 'center', margin: '0 0 10px' }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>{res.total.toLocaleString('hu-HU')} találat · {res.page}/{res.pages}. oldal</p>
            {lockedCount > 1 && (
              <button className="btn ghost sm" disabled={busy} onClick={bulkUnlock}>
                Mind feloldása ({lockedCount}) · −{pricing?.BULK_DISCOUNT_PCT ?? 20}%
              </button>
            )}
            <button className="btn ghost sm" disabled={busy} onClick={exportPage}>
              CSV export · {pricing?.EXPORT_PAGE_COST ?? 5} <IconCoin size={12} />
            </button>
          </div>
          <LeadTable items={res.items} pricing={pricing} onUpdate={patch} />
          <div className="pager">
            <button className="btn ghost sm" disabled={busy || res.page <= 1} onClick={() => search(res.page - 1)}>← Előző</button>
            <span className="muted">{res.page} / {res.pages}</span>
            <button className="btn ghost sm" disabled={busy || res.page >= res.pages} onClick={() => search(res.page + 1)}>
              Következő · {pricing?.SEARCH_COST ?? 1} <IconCoin size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
