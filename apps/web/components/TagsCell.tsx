'use client';

import { useEffect, useRef, useState } from 'react';

// preset colors offered when creating a new tag
const PALETTE = ['#6366f1', '#22c55e', '#f43f5e', '#f59e0b', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#14b8a6', '#3b82f6', '#eab308', '#94a3b8'];

// pick readable text color for a given chip background
function textOn(bg: string): string {
  const h = bg.replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b1020' : '#fff';
}

export default function TagsCell({ tags, registry, allNames, onAdd, onRemove, onCreate }: {
  tags: string[];
  registry: Record<string, string>;
  allNames: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onCreate: (name: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const openPop = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 250), top: r.bottom + 4 });
    setColor(PALETTE[(allNames.length + tags.length) % PALETTE.length]);
    setQ('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);

  const query = q.trim();
  const lower = query.toLowerCase();
  const suggestions = allNames.filter((n) => !tags.includes(n) && n.toLowerCase().includes(lower)).slice(0, 8);
  const exact = allNames.some((n) => n.toLowerCase() === lower);

  const add = (name: string) => { onAdd(name); setQ(''); };
  const create = () => { if (!query || exact) return; onCreate(query, color); onAdd(query); setQ(''); };

  return (
    <div className="tags-cell">
      <div className="tags-chips">
        {tags.map((t) => {
          const c = registry[t] || '#6366f1';
          return (
            <span key={t} className="tagchip" style={{ background: c, color: textOn(c) }}>
              {t}<span className="tagx" onClick={(e) => { e.stopPropagation(); onRemove(t); }}>×</span>
            </span>
          );
        })}
        <button ref={btnRef} className="tagadd" title="Add tag" onClick={() => (open ? setOpen(false) : openPop())}>+</button>
      </div>

      {open && pos && (
        <div ref={popRef} className="tags-pop" style={{ left: pos.left, top: pos.top }}>
          <input
            autoFocus className="tags-input" placeholder="Search or create…" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const m = suggestions.find((s) => s.toLowerCase() === lower); if (m) add(m); else create(); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="tags-list">
            {suggestions.map((s) => {
              const c = registry[s] || '#6366f1';
              return (
                <div key={s} className="tagopt" onClick={() => add(s)}>
                  <span className="tagdot" style={{ background: c }} /><span className="tagopt-name">{s}</span>
                </div>
              );
            })}
            {query && !exact && (
              <div className="tagcreate">
                <div className="tagopt create" onClick={create}>
                  <span className="tagdot" style={{ background: color }} /><span className="tagopt-name">Create “{query}”</span>
                </div>
                <div className="palette">
                  {PALETTE.map((c) => (
                    <span key={c} className={`sw ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>
            )}
            {!suggestions.length && !query && <div className="tagempty">Type to search or create a tag</div>}
          </div>
        </div>
      )}
    </div>
  );
}
