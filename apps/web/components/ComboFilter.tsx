'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Combobox: free-text input + autocomplete dropdown. Typing filters both the
// suggestions and (live) the applied value; picking a suggestion sets it exactly.
export default function ComboFilter({ value, options, placeholder, onChange }:
  { value: string; options: string[]; placeholder: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setText(value); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, value]);
  useEffect(() => { if (open && active >= 0 && listRef.current) { const el = listRef.current.children[active] as HTMLElement; el?.scrollIntoView({ block: 'nearest' }); } }, [active, open]);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 500);
  }, [text, options]);
  const choose = (v: string) => { onChange(v); setText(v); setActive(-1); setOpen(false); };

  return (
    <div className="combo" ref={ref}>
      <input
        className="side-facet combo-input" placeholder={placeholder} value={text}
        onFocus={() => { setOpen(true); setActive(-1); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); onChange(e.target.value); }}
        onKeyDown={(e) => {
          if (!open && e.key === 'ArrowDown') { setOpen(true); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { if (active >= 0 && shown[active]) { e.preventDefault(); choose(shown[active]); } else setOpen(false); }
          else if (e.key === 'Escape') { setOpen(false); setText(value); }
        }}
      />
      {value && <span className="combo-x" title="Clear" onMouseDown={(e) => { e.preventDefault(); onChange(''); setText(''); }}>✕</span>}
      {open && shown.length > 0 && (
        <div className="combo-pop" ref={listRef}>
          {shown.map((o, i) => (
            <div key={o} className={`combo-opt ${i === active ? 'active' : ''} ${o === value ? 'sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}>{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}
