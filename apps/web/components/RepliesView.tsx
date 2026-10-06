'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { InboxItem, SuppressionRow } from '@/lib/api';

// Replies tab: what came back to the sender mailboxes, readable without opening
// a mailbox. The replies are not sorted into good and bad by a machine: a
// person tells at a glance, and a wrong machine guess loses someone who was
// interested. Mail that matched no lead is listed too; it never just disappears.

type Show = 'replies' | 'bounces' | 'unmatched' | 'suppressed';
const TABS: [Show, string][] = [['replies', 'Replies'], ['bounces', 'Bounces'], ['unmatched', 'Matched no lead'], ['suppressed', 'Suppression list']];
const REASON: Record<string, string> = { stop: 'asked to stop', hard_bounce: 'the address bounced', complaint: 'complained', manual: 'added by hand', import: 'imported' };
const BOUNCE: Record<string, [string, string]> = {
  hard: ['red', 'Address does not exist'], soft: ['amber', 'Temporary'], block: ['pink', 'We were blocked'], unknown: ['gray', 'Could not be read'],
};

export default function RepliesView() {
  const [show, setShow] = useState<Show>('replies');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);
  // the suppression list, shown on its own tab of this view
  const [suppressed, setSuppressed] = useState<SuppressionRow[]>([]);
  const [suppressedTotal, setSuppressedTotal] = useState(0);
  const [entry, setEntry] = useState('');
  const [listNote, setListNote] = useState('');
  const loadSuppressed = useCallback((search = '') => {
    setLoading(true);
    api.getSuppressions(search)
      .then((r) => { if (r.ok) { setSuppressed(r.rows || []); setSuppressedTotal(r.total || 0); setError(''); } else setError(r.error || 'The suppression list could not be loaded.'); })
      .catch(() => setError('The suppression list could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  const changeList = async (action: 'add' | 'addDomain' | 'remove', value: string) => {
    setListNote('');
    try {
      const r = await api.changeSuppression(action, value);
      setListNote(r.ok ? (action === 'remove' ? `${value} may be written to again.` : `${value} is suppressed.`) : r.error || 'That could not be saved.');
      if (r.ok) { setEntry(''); loadSuppressed(); }
    } catch {
      setListNote('Network error. Nothing was changed.');
    }
  };

  const load = useCallback((which: Show) => {
    if (which === 'suppressed') { loadSuppressed(); return; }
    setLoading(true);
    api.getInbox(which)
      .then((r) => { if (r.ok) { setItems(r.items || []); setUnseen(r.unseen || 0); setError(''); } else setError(r.error || 'The replies could not be loaded.'); })
      .catch(() => setError('The replies could not be loaded.'))
      .finally(() => setLoading(false));
  }, [loadSuppressed]);
  useEffect(() => { load(show); }, [load, show]);

  const markSeen = async () => {
    setMarking(true);
    try {
      const r = await api.markRepliesSeen();
      if (!r.ok) setError(r.error || 'That could not be saved.');
      load(show);
    } catch {
      setError('Network error. Nothing was changed.');
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">💌 Replies</div>
        {unseen > 0 && <span className="chip red">{unseen} not read yet</span>}
        <div className="spacer" />
        {TABS.map(([key, label]) => <button key={key} className={`chipbtn ${show === key ? 'active' : ''}`} onClick={() => setShow(key)}>{label}</button>)}
        <button className="btn" onClick={() => load(show)} disabled={loading}>⟳ Refresh</button>
        {show !== 'suppressed' && <button className="btn" onClick={markSeen} disabled={marking || !unseen}>{marking ? 'Saving…' : 'Mark all as read'}</button>}
      </div>
      {loading && !items.length && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load(show)}>Try again</button></div>}
      {show === 'suppressed' && (
        <div className="oseq-card">
          <div className="oseq-row"><b>Never written to</b><span className="muted">{suppressedTotal.toLocaleString()} on the list. It outlives the lead: a deleted and re-scraped business stays out.</span></div>
          <form className="oseq-row" onSubmit={(e) => { e.preventDefault(); if (entry.trim()) changeList(entry.includes('@') ? 'add' : 'addDomain', entry.trim()); }}>
            <input className="search" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="An address, or a company domain" aria-label="Address or company domain" />
            <button className="btn" type="submit" disabled={!entry.trim()}>Suppress</button>
            <button className="btn" type="button" disabled={!entry.trim()} onClick={() => loadSuppressed(entry.trim())}>Search</button>
          </form>
          {listNote && <div className="oseq-hint">{listNote}</div>}
          {!loading && !suppressed.length && <div className="muted oseq-hint">Nothing here.</div>}
          {suppressed.map((r) => (
            <div key={r.email} className="oseq-row">
              <span>{r.domain ? `Everyone at ${r.domain}` : r.email}</span>
              <span className="chip gray">{REASON[r.reason] || r.reason || 'no reason recorded'}</span>
              <span className="muted">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}{r.note ? ` · ${r.note}` : ''}</span>
              <div className="spacer" />
              <button className="mini danger" title="Only when the block was a mistake, or the person asks to be written to again" onClick={() => { if (confirm(`Lift the suppression of ${r.domain || r.email}? It may be written to again.`)) changeList('remove', r.domain || r.email); }}>Lift</button>
            </div>
          ))}
        </div>
      )}
      {show !== 'suppressed' && !loading && !error && !items.length && (
        <div className="empty">{show === 'replies' ? 'No replies yet.' : show === 'bounces' ? 'No bounces.' : 'Nothing is waiting here: every message matched a lead.'}</div>
      )}
      <div className="oseq-list">
        {show !== 'suppressed' && items.map((m) => (
          <div key={m.id} className="oseq-card">
            <div className="oseq-row">
              <b>{m.leadName || m.from}</b>
              {m.kind === 'human' && !m.seenAt && <span className="chip blue">New</span>}
              {m.stop && <span className="chip red">Asked to stop: taken out and suppressed</span>}
              {m.kind === 'bounce' && <span className={`chip ${(BOUNCE[m.bounceKind] || BOUNCE.unknown)[0]}`}>{(BOUNCE[m.bounceKind] || BOUNCE.unknown)[1]}{m.bounceStatus ? ` · ${m.bounceStatus}` : ''}</span>}
              {m.ignored && <span className="chip amber">Nothing was changed: {m.ignored}</span>}
              {!m.dedupKey && !m.ignored && <span className="chip amber">Matched no lead: look at it in the mailbox</span>}
              {m.matchedBy === 'subject' && <span className="chip gray">Matched by the subject</span>}
              <span className="muted">{m.from}</span>
              <div className="spacer" />
              <span className="muted">{m.at ? new Date(m.at).toLocaleString() : ''}</span>
            </div>
            <div className="oseq-subject">{m.subject || 'No subject'}</div>
            {m.text && <pre className="wp-text">{m.text}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
