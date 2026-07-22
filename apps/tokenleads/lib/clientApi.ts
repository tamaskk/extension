'use client';
import { useApp } from './store';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}
export class NotEnoughTokens extends ApiError {
  constructor(public balance: number, public required: number) {
    super(402, 'insufficient_tokens', { balance, required });
  }
}
export class RateLimited extends ApiError {
  constructor(public retryAfter: number) {
    super(429, 'rate_limited', { retryAfter });
  }
}
export class NotVerified extends ApiError {
  constructor() { super(403, 'email_not_verified'); }
}

// Every API response carrying a numeric `balance` updates the header chip —
// spend/credit endpoints all return the fresh balance, so the UI never polls.
// A 402 opens the global purchase modal in addition to throwing.
export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (typeof data.balance === 'number') useApp.getState().setBalance(data.balance);
  if (!res.ok) {
    if (res.status === 402) {
      useApp.getState().setBuyOpen(true);
      throw new NotEnoughTokens(Number(data.balance) || 0, Number(data.required) || 0);
    }
    if (res.status === 429) throw new RateLimited(Number(data.retryAfter) || 60);
    if (res.status === 403 && data.error === 'email_not_verified') throw new NotVerified();
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
    throw new ApiError(res.status, String(data.error || res.statusText), data);
  }
  return data as T;
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
}

// Trigger a file download from an authenticated endpoint (CSV export).
export async function downloadFile(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) {
      useApp.getState().setBuyOpen(true);
      throw new NotEnoughTokens(Number(data.balance) || 0, Number(data.required) || 0);
    }
    // Mirror api()'s error-class contract so callers can branch consistently.
    if (res.status === 429) throw new RateLimited(Number(data.retryAfter) || 60);
    if (res.status === 403 && data.error === 'email_not_verified') throw new NotVerified();
    throw new ApiError(res.status, String(data.error || res.statusText), data);
  }
  const balance = res.headers.get('X-Balance');
  if (balance) useApp.getState().setBalance(Number(balance));
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Recently viewed leads — localStorage ring buffer for the dashboard widget.
export interface RecentLead { id: string; name: string; city: string; at: number; }
const RECENT_KEY = 'tl_recent';

export function pushRecent(lead: RecentLead) {
  try {
    const arr: RecentLead[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const next = [lead, ...arr.filter((r) => r.id !== lead.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* quota/parse — non-critical */ }
}

export function getRecent(): RecentLead[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
