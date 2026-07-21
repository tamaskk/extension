'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LeadRow } from '@/lib/types';

type GroupRow = { groupId: string; name: string; createdAt: string; count: number };
const PAGE_SIZE = 100;

// Groups tab: list of saved lead groups; click one to see its members.
export default function GroupsView() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<GroupRow | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(false);

  const loadGroups = useCallback(() => {
    setLoading(true);
    api.getGroups().then((r) => setGroups(r.groups || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setRowsLoading(true);
    api.getGroupLeads(active.groupId, page, PAGE_SIZE).then((r) => {
      if (cancelled || !r.ok) return;
      setRows((r.rows || []).map((x: any) => ({ ...x, _project: x.project, _key: x.dedupKey })) as LeadRow[]);
      setTotal(r.total || 0);
    }).catch(() => {}).finally(() => { if (!cancelled) setRowsLoading(false); });
    return () => { cancelled = true; };
  }, [active, page]);

  const openGroup = (g: GroupRow) => { setActive(g); setPage(1); setRows([]); setTotal(0); };

  const rename = (g: GroupRow) => {
    const name = prompt('Rename group:', g.name);
    if (!name || !name.trim() || name.trim() === g.name) return;
    api.renameGroup(g.groupId, name.trim()).then(loadGroups).catch(() => {});
    if (active?.groupId === g.groupId) setActive({ ...g, name: name.trim() });
  };

  const remove = (g: GroupRow) => {
    if (!confirm(`Delete group "${g.name}"? The leads themselves stay.`)) return;
    api.deleteGroup(g.groupId).then(loadGroups).catch(() => {});
    if (active?.groupId === g.groupId) setActive(null);
  };

  const removeMember = (r: LeadRow) => {
    if (!active) return;
    api.removeFromGroup(active.groupId, [r._key]).catch(() => {});
    setRows((rs) => rs.filter((x) => x._key !== r._key));
    setTotal((t) => Math.max(0, t - 1));
    setGroups((gs) => gs.map((g) => (g.groupId === active.groupId ? { ...g, count: Math.max(0, g.count - 1) } : g)));
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── member list of one group ────────────────────────────────────────────
  if (active) return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <button className="btn" onClick={() => setActive(null)}>← Groups</button>
        <div className="groups-title">🗂 {active.name} <span className="muted">— {total.toLocaleString()} leads</span></div>
        <div className="spacer" />
        <button className="btn" onClick={() => rename(active)}>✎ Rename</button>
        <button className="btn" onClick={() => remove(active)}>🗑 Delete group</button>
      </div>
      {rowsLoading && !rows.length && <div className="empty" style={{ padding: 30 }}>Loading…</div>}
      {!rowsLoading && !rows.length && <div className="empty" style={{ padding: 30 }}>This group is empty.</div>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="table calls-table">
            <thead><tr>
              <th>Business</th><th>Category</th><th>★</th><th>Reviews</th><th>Phone</th><th>Email</th><th>Website</th><th>Opp</th><th>Location</th><th>Maps</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._key}>
                  <td className="bizname" title={r.name}>{r.name}</td>
                  <td className="muted">{r.category}</td>
                  <td>{r.rating ?? '—'}</td>
                  <td className="muted">{r.reviewCount ?? '—'}</td>
                  <td>{r.phone || <span className="muted">—</span>}</td>
                  <td>{r.email || <span className="muted">—</span>}</td>
                  <td>{r.website ? <a className="mlink" href={r.website} target="_blank" rel="noreferrer">open ↗</a> : <span className="muted">—</span>}</td>
                  <td>{r.opportunityScore ?? '—'}</td>
                  <td className="muted" title={r.address || ''}>{r.address || ''}</td>
                  <td>{r.mapsUrl ? <a className="mlink" href={r.mapsUrl} target="_blank" rel="noreferrer">map ↗</a> : ''}</td>
                  <td><span className="calls-rm" title="Remove from group" onClick={() => removeMember(r)}>✕</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="groups-pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span className="muted">Page {page} / {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );

  // ── group list ──────────────────────────────────────────────────────────
  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">🗂 Groups</div>
        <div className="spacer" />
        <button className="btn" onClick={loadGroups}>⟳ Refresh</button>
      </div>
      {loading && <div className="empty" style={{ padding: 30 }}>Loading…</div>}
      {!loading && !groups.length && (
        <div className="empty" style={{ padding: 30 }}>
          No groups yet. Tick the <b>Checked</b> column on some leads, then press <b>🗂 Group</b> in the header to save them as a group.
        </div>
      )}
      <div className="groups-grid">
        {groups.map((g) => (
          <div key={g.groupId} className="group-card" onClick={() => openGroup(g)}>
            <div className="group-card-name" title={g.name}>🗂 {g.name}</div>
            <div className="group-card-meta">
              <span className="badge">{g.count.toLocaleString()} leads</span>
              <span className="muted">{(g.createdAt || '').slice(0, 10)}</span>
            </div>
            <div className="group-card-actions">
              <span className="edit" title="Rename" onClick={(e) => { e.stopPropagation(); rename(g); }}>✎</span>
              <span className="del" title="Delete" onClick={(e) => { e.stopPropagation(); remove(g); }}>✕</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
