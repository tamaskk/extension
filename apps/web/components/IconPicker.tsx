'use client';

import { useEffect, useRef, useState } from 'react';

// Business-type icons (Google Maps categories): food, drink, trades, services…
export const BUSINESS_ICONS = [
  '🍽️', '🍔', '🍕', '🍣', '🌮', '🥗', '🍜', '🍱', '☕', '🥐', '🍰', '🧁', '🍩', '🍦', '🥖',
  '🍺', '🍷', '🍸', '🍹', '🥂', '🛒', '🏪', '🏨', '🛏️', '🏠', '🏢',
  '💇', '💈', '💅', '🧖', '💆', '👗', '👟', '👓', '💍', '⌚', '📷', '💐', '📚', '🎵', '🎬', '🎮',
  '🔧', '🚰', '🔌', '🔨', '🪚', '🧱', '🪜', '🧹', '🧽', '🌳', '🚜', '🎨',
  '🚗', '🏍️', '🚲', '⛽', '🚚', '🏥', '🦷', '💊', '🩺', '🐕', '🐾',
  '💪', '🧘', '⚽', '🎾', '⚖️', '💼', '🏦', '🖥️', '📱', '🔑', '✂️', '🪡', '🎂', '🍫', '🧴', '🛠️', '🔭',
];

export default function IconPicker({ trigger, onPick }: { trigger: React.ReactNode; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 250), top: r.bottom + 4 });
    setOpen(true);
  };

  return (
    <span ref={btnRef} className="iconpick-trigger" onClick={toggle}>
      {trigger}
      {open && pos && (
        <div ref={popRef} className="iconpick-pop" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
          <div className="iconpick-grid">
            <span className="iconpick-i clear" title="Default folder icon" onClick={() => { onPick(''); setOpen(false); }}>📁</span>
            {[...new Set(BUSINESS_ICONS)].map((ic) => (
              <span key={ic} className="iconpick-i" onClick={() => { onPick(ic); setOpen(false); }}>{ic}</span>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
