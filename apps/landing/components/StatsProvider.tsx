'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LeadStats } from '@/lib/types';

interface StatsState {
  stats: LeadStats | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const StatsContext = createContext<StatsState>({ stats: null, loading: true, error: null, reload: () => {} });

export function useStats() {
  return useContext(StatsContext);
}

export default function StatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/stats')
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.error) throw new Error(j?.error || `Request failed (${r.status})`);
        setStats(j as LeadStats);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return <StatsContext.Provider value={{ stats, loading, error, reload }}>{children}</StatsContext.Provider>;
}

/** Signature moment, shared by every live number on the page: the value rolls
    up from 0 when it scrolls into view — mono tabular digits, so the width
    never jitters. Reduced motion renders the final value instantly. */
export function NumberRoll({ value, format = fmt }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || started.current) return;
      started.current = true;
      io.disconnect();
      if (reduce) { setShown(value); return; }
      const t0 = performance.now();
      const dur = 1100;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return <span ref={ref}>{format(shown)}</span>;
}

/** 1,109,450 → "1.1M" — for hero/testimonial headline numbers */
export function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
