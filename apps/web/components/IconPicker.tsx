'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Country flags (the countries we scrape) — handy for top-level country folders.
export const FLAG_ICONS = [
  '🇦🇹', '🇧🇪', '🇨🇦', '🇫🇷', '🇬🇷', '🇭🇰', '🇭🇺', '🇮🇹', '🇳🇱', '🇵🇹', '🇪🇸', '🇨🇭', '🇹🇼', '🇬🇧', '🇺🇸', '🇦🇪',
];
// Business-type icons (Google Maps categories): food, drink, trades, services…
export const BUSINESS_ICONS = [
  ...FLAG_ICONS,
  '🍽️', '🍔', '🍕', '🍣', '🌮', '🥗', '🍜', '🍱', '☕', '🥐', '🍰', '🧁', '🍩', '🍦', '🥖',
  '🍺', '🍷', '🍸', '🍹', '🥂', '🛒', '🏪', '🏨', '🛏️', '🏠', '🏢',
  '💇', '💈', '💅', '🧖', '💆', '👗', '👟', '👓', '💍', '⌚', '📷', '💐', '📚', '🎵', '🎬', '🎮',
  '🔧', '🚰', '🔌', '❄️', '🔨', '🪚', '🧱', '🪜', '🧹', '🧽', '🌳', '🚜', '🎨',
  '🚗', '🏍️', '🚲', '⛽', '🚚', '🏥', '🦷', '💊', '🩺', '🧑‍⚕️', '🐕', '🐾',
  '💪', '🧘', '⚽', '🎾', '⚖️', '💼', '🏦', '📈', '🖥️', '📱', '🔑', '✂️', '🪡', '🎂', '🍫', '🧴', '🛠️', '🔭',
];

// human label per icon — shown as a tooltip on hover
export const ICON_LABELS: Record<string, string> = {
  '🇦🇹': 'Austria', '🇧🇪': 'Belgium', '🇨🇦': 'Canada', '🇫🇷': 'France', '🇬🇷': 'Greece', '🇭🇰': 'Hong Kong',
  '🇭🇺': 'Hungary', '🇮🇹': 'Italy', '🇳🇱': 'Netherlands', '🇵🇹': 'Portugal', '🇪🇸': 'Spain', '🇨🇭': 'Switzerland',
  '🇹🇼': 'Taiwan', '🇬🇧': 'United Kingdom', '🇺🇸': 'United States', '🇦🇪': 'United Arab Emirates',
  '🍽️': 'Restaurant', '🍔': 'Fast food', '🍕': 'Pizzeria', '🍣': 'Sushi', '🌮': 'Mexican', '🥗': 'Healthy / salad',
  '🍜': 'Noodles / ramen', '🍱': 'Asian / bento', '☕': 'Café', '🥐': 'Bakery', '🍰': 'Dessert / cake', '🧁': 'Cupcakes',
  '🍩': 'Donuts', '🍦': 'Ice cream', '🥖': 'Bakery / bread', '🍺': 'Bar / pub', '🍷': 'Wine bar', '🍸': 'Cocktail bar',
  '🍹': 'Cocktails', '🥂': 'Lounge', '🛒': 'Grocery store', '🏪': 'Convenience store', '🏨': 'Hotel', '🛏️': 'Accommodation',
  '🏠': 'Real estate', '🏢': 'Office / company', '💇': 'Hair salon', '💈': 'Barber', '💅': 'Nail salon', '🧖': 'Spa',
  '💆': 'Massage', '👗': 'Clothing', '👟': 'Shoe store', '👓': 'Optician', '💍': 'Jewelry', '⌚': 'Watches',
  '📷': 'Photographer', '💐': 'Florist', '📚': 'Bookstore', '🎵': 'Music', '🎬': 'Cinema', '🎮': 'Gaming',
  '🔧': 'Mechanic', '🚰': 'Plumber', '🔌': 'Electrician', '❄️': 'HVAC', '🔨': 'Construction', '🪚': 'Carpentry', '🧱': 'Masonry',
  '🪜': 'Handyman', '🧹': 'Cleaning', '🧽': 'Cleaning service', '🌳': 'Landscaping', '🚜': 'Agriculture', '🎨': 'Painter / art',
  '🚗': 'Car dealer', '🏍️': 'Motorcycle', '🚲': 'Bicycle shop', '⛽': 'Gas station', '🚚': 'Moving / delivery',
  '🏥': 'Clinic / medical / private clinic', '🦷': 'Dentist / dental clinic', '💊': 'Pharmacy', '🩺': 'Doctor', '🧑‍⚕️': 'Physiotherapist / physio', '🐕': 'Veterinary', '🐾': 'Pet services',
  '💪': 'Gym / fitness', '🧘': 'Yoga / wellness', '⚽': 'Sports', '🎾': 'Tennis / sports club', '⚖️': 'Lawyer',
  '💼': 'Business services', '🏦': 'Bank / finance', '📈': 'Financial planner / advisor', '🖥️': 'IT / computer', '📱': 'Phone repair', '🔑': 'Locksmith',
  '✂️': 'Tailor', '🪡': 'Sewing / alterations', '🎂': 'Cake shop', '🍫': 'Chocolate / sweets', '🧴': 'Cosmetics',
  '🛠️': 'Repair / handyman', '🔭': 'Other',
};

const normIcon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export default function IconPicker({ trigger, onPick }: { trigger: React.ReactNode; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [q, setQ] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  const icons = useMemo(() => {
    const list = [...new Set(BUSINESS_ICONS)];
    const nq = normIcon(q);
    return nq ? list.filter((ic) => normIcon(ICON_LABELS[ic] || '').includes(nq)) : list;
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    // close on PAGE scroll, but not when scrolling inside the icon list itself
    const onScroll = (e: Event) => { if (popRef.current && popRef.current.contains(e.target as Node)) return; setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 250), top: r.bottom + 4 });
    setQ('');
    setOpen(true);
  };

  return (
    <span ref={btnRef} className="iconpick-trigger" onClick={toggle}>
      {trigger}
      {open && pos && (
        <div ref={popRef} className="iconpick-pop" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
          <input className="iconpick-search" placeholder="Search icon (e.g. lawyer, HVAC, spa)…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="iconpick-grid">
            {!q && <span className="iconpick-i clear" title="Default folder icon" onClick={() => { onPick(''); setOpen(false); }}>📁</span>}
            {icons.map((ic) => (
              <span key={ic} className="iconpick-i" title={ICON_LABELS[ic] || ''} onClick={() => { onPick(ic); setOpen(false); }}>{ic}</span>
            ))}
            {icons.length === 0 && <span className="iconpick-empty">No icon matches “{q}”.</span>}
          </div>
        </div>
      )}
    </span>
  );
}
