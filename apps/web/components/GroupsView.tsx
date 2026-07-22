'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type GroupRow = { groupId: string; name: string; createdAt: string; count: number };

// Groups tab: card list of saved lead groups. Opening one hands off to the
// main leads table (Dashboard scopes it to the group), so members get the
// full table UI — columns, sorting, filters, detail panel.
export default function GroupsView({ onOpen, onCall }: { onOpen: (g: GroupRow) => void; onCall: (g: GroupRow) => void }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(() => {
    setLoading(true);
    api.getGroups().then((r) => setGroups(r.groups || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const rename = (g: GroupRow) => {
    const name = prompt('Rename group:', g.name);
    if (!name || !name.trim() || name.trim() === g.name) return;
    api.renameGroup(g.groupId, name.trim()).then(loadGroups).catch(() => {});
  };

  const remove = (g: GroupRow) => {
    if (!confirm(`Delete group "${g.name}"? The leads themselves stay.`)) return;
    api.deleteGroup(g.groupId).then(loadGroups).catch(() => {});
  };

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
          No groups yet. Select some leads in the table (left checkboxes), then press <b>🗂 Group</b> to save them as a group.
        </div>
      )}
      <div className="groups-grid">
        {groups.map((g) => (
          <div key={g.groupId} className="group-card" onClick={() => onOpen(g)}>
            <div className="group-card-name" title={g.name}>🗂 {g.name}</div>
            <div className="group-card-meta">
              <span className="badge">{g.count.toLocaleString()} leads</span>
              <span className="muted">{(g.createdAt || '').slice(0, 10)}</span>
              <span className="spacer" />
              <button className="mini" title="Call this group with the Vapi voice assistant" onClick={(e) => { e.stopPropagation(); onCall(g); }}>📞 Call</button>
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
