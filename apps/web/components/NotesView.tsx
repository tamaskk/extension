'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow } from '@/lib/types';
import ReviewsModal from './ReviewsModal';

const PAGE_SIZE = 50;

// Notes tab: every lead that has a note, newest edit first. Clicking one opens
// the standard lead detail panel (where the note is edited).
export default function NotesView() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [debTerm, setDebTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LeadRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebTerm(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  useEffect(() => { setPage(1); }, [debTerm]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getNotes({ search: debTerm, page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (cancelled || !r.ok) return;
        setRows((r.rows || []).map((x: any) => ({ ...x, _project: x.project, _key: x.dedupKey })) as LeadRow[]);
        setTotal(r.total || 0);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debTerm, page, reloadKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">📝 Notes</div>
        <span className="muted">{loading ? '' : `${total.toLocaleString()} lead(s) with notes`}</span>
        <div className="spacer" />
        <input className="search cats-search" type="search" placeholder="Search notes, business, city…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>⟳ Refresh</button>
      </div>
      {loading && !rows.length && <div className="empty" style={{ padding: 30 }}>Loading…</div>}
      {!loading && !rows.length && (
        <div className="empty" style={{ padding: 30 }}>
          No notes yet. Open a lead&apos;s detail panel and write into the <b>📝 Notes</b> box — everything you type shows up here.
        </div>
      )}
      <div className="notes-list">
        {rows.map((r) => (
          <div key={`${r._project}|${r._key}`} className="note-card" onClick={() => setDetail(r)}>
            <div className="note-card-top">
              <span className="note-card-name" title={r.name}>{r.name}</span>
              <span className="muted note-card-date">{r.notesAt ? new Date(r.notesAt).toLocaleString() : ''}</span>
            </div>
            <div className="note-card-meta muted">{[r.category, r.address].filter(Boolean).join(' · ')}</div>
            <div className="note-card-text">{r.notes}</div>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="groups-pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span className="muted">Page {page} / {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
      {detail && <ReviewsModal key={`${detail._project}|${detail._key}`} lead={detail} initialTab="info"
        onClose={() => { setDetail(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
