'use client';

import { useEffect, useRef, useState } from 'react';

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
  '🔧', '🚰', '🔌', '🔨', '🪚', '🧱', '🪜', '🧹', '🧽', '🌳', '🚜', '🎨',
  '🚗', '🏍️', '🚲', '⛽', '🚚', '🏥', '🦷', '💊', '🩺', '🐕', '🐾',
  '💪', '🧘', '⚽', '🎾', '⚖️', '💼', '🏦', '🖥️', '📱', '🔑', '✂️', '🪡', '🎂', '🍫', '🧴', '🛠️', '🔭',
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
  '🔧': 'Mechanic', '🚰': 'Plumber', '🔌': 'Electrician', '🔨': 'Construction', '🪚': 'Carpentry', '🧱': 'Masonry',
  '🪜': 'Handyman', '🧹': 'Cleaning', '🧽': 'Cleaning service', '🌳': 'Landscaping', '🚜': 'Agriculture', '🎨': 'Painter / art',
  '🚗': 'Car dealer', '🏍️': 'Motorcycle', '🚲': 'Bicycle shop', '⛽': 'Gas station', '🚚': 'Moving / delivery',
  '🏥': 'Clinic', '🦷': 'Dentist', '💊': 'Pharmacy', '🩺': 'Doctor', '🐕': 'Veterinary', '🐾': 'Pet services',
  '💪': 'Gym / fitness', '🧘': 'Yoga / wellness', '⚽': 'Sports', '🎾': 'Tennis / sports club', '⚖️': 'Lawyer',
  '💼': 'Business services', '🏦': 'Bank / finance', '🖥️': 'IT / computer', '📱': 'Phone repair', '🔑': 'Locksmith',
  '✂️': 'Tailor', '🪡': 'Sewing / alterations', '🎂': 'Cake shop', '🍫': 'Chocolate / sweets', '🧴': 'Cosmetics',
  '🛠️': 'Repair / handyman', '🔭': 'Other',
};

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
              <span key={ic} className="iconpick-i" title={ICON_LABELS[ic] || ''} onClick={() => { onPick(ic); setOpen(false); }}>{ic}</span>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
