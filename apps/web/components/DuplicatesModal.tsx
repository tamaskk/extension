'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGrid } from '@/lib/store';
import { api, type DupeGroup } from '@/lib/api';

export default function DuplicatesModal({ onClose, onGoto, onChanged }: { onClose: () => void; onGoto: (q: string) => void; onChanged: () => void }) {
  const summaries = useGrid((s) => s.summaries);
  const [groups, setGroups] = useState<DupeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState(false);
  const lastIdx = useRef<number | null>(null);

  const projName = (q: string) => summaries[q]?.name || q;
  const keyOf = (project: string, key: string) => `${project}|${key}`;

  const load = async () => {
    setLoading(true);
    const g = await api.getDuplicates().catch(() => []);
    setGroups(g);
    setSelected(new Set());
    lastIdx.current = null;
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flat = useMemo(() => groups.flatMap((g) => g.items.map((it) => keyOf(it.project, it.key))), [groups]);

  const toggle = (k: string, checked: boolean, shift: boolean) => {
    const next = new Set(selected);
    const idx = flat.indexOf(k);
    if (shift && lastIdx.current !== null && lastIdx.current !== idx) {
      const lo = Math.min(lastIdx.current, idx), hi = Math.max(lastIdx.current, idx);
      for (let i = lo; i <= hi; i++) { if (checked) next.add(flat[i]); else next.delete(flat[i]); }
    } else if (checked) next.add(k); else next.delete(k);
    lastIdx.current = idx;
    setSelected(next);
  };

  const toItems = (keys: string[]) => keys.map((k) => { const [query, key] = k.split('|'); return { query, key }; });

  const del = async (items: { query: string; key: string }[]) => {
    if (!items.length) return;
    await api.deleteRecords(items);
    onChanged();
    await load();
  };

  const deleteSelected = async () => { if (selected.size && confirm(`Delete ${selected.size} selected copies?`)) await del(toItems([...selected])); };
  const fixGroup = (g: DupeGroup) => del(g.items.slice(0, -1).map((it) => ({ query: it.project, key: it.key })));
  const fixAll = async () => {
    const items = groups.flatMap((g) => g.items.slice(0, -1).map((it) => ({ query: it.project, key: it.key })));
    if (!items.length) return;
    if (!confirm(`Fix all ${groups.length} groups? This deletes ${items.length} duplicate copies (the last copy of each business is kept).`)) return;
    setFixing(true); await del(items); setFixing(false);
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">⧉ Duplicate businesses</div>
            <div className="modal-sub">{loading ? 'Scanning…' : `${groups.length} duplicate group(s) across your projects`}</div>
          </div>
          <div className="modal-actions">
            {selected.size > 0 && <button className="btn danger" onClick={deleteSelected}>🗑 Delete selected ({selected.size})</button>}
            <button className="btn fixall" disabled={fixing || !groups.length} onClick={fixAll}>{fixing ? '⚡ Fixing…' : '⚡ Fix all'}</button>
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="dupe-empty">Scanning the database…</div>
          ) : !groups.length ? (
            <div className="dupe-empty">🎉 No duplicates found — every business appears in only one project.</div>
          ) : groups.map((g, gi) => (
            <div className="dupe-group" key={gi}>
              <div className="dupe-group-head">
                <span className="dupe-name">{g.name}</span>
                <span className="dupe-meta">{g.address || ''} · in {g.items.length} projects</span>
                <button className="dupe-fix" title="Keep the last copy, delete the rest" onClick={() => fixGroup(g)}>⚡ Fix it</button>
              </div>
              {g.items.map((it) => {
                const k = keyOf(it.project, it.key);
                return (
                  <div className="dupe-row" key={k}>
                    <input type="checkbox" className="dupe-check" checked={selected.has(k)} onChange={() => {}} onClick={(e) => toggle(k, !selected.has(k), e.shiftKey)} />
                    <span className="dupe-proj" title={`Open project: ${projName(it.project)}`} onClick={() => onGoto(it.project)}>📁 {projName(it.project)}</span>
                    <span className="dupe-info">{it.category || ''}{it.rating ? ` · ★ ${it.rating}` : ''}{it.reviewCount ? ` · ${it.reviewCount} reviews` : ''}{it.checked ? ' · ✓ checked' : ''}</span>
                    <button className="dupe-del" onClick={() => del([{ query: it.project, key: it.key }])}>Delete</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
