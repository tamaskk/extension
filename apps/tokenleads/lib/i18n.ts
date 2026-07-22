'use client';
// Lightweight i18n for the app chrome (nav, topbar, auth, common buttons).
// Page-body copy is Hungarian-first; EN coverage of long-form strings is a
// follow-up — this module is the infrastructure + the high-traffic strings.
import { useSyncExternalStore } from 'react';

export type Lang = 'hu' | 'en';
const KEY = 'tl_lang';

const DICT: Record<string, { hu: string; en: string }> = {
  'nav.dashboard': { hu: 'Áttekintés', en: 'Overview' },
  'nav.leads': { hu: 'Lead kereső', en: 'Lead finder' },
  'nav.myleads': { hu: 'Saját leadek', en: 'My leads' },
  'nav.wallet': { hu: 'Egyenleg', en: 'Balance' },
  'nav.settings': { hu: 'Beállítások', en: 'Settings' },
  'nav.admin': { hu: 'Admin', en: 'Admin' },
  'nav.logout': { hu: 'Kilépés', en: 'Log out' },
  'title.dashboard': { hu: 'Áttekintés', en: 'Overview' },
  'title.leads': { hu: 'Lead kereső', en: 'Lead finder' },
  'title.myleads': { hu: 'Saját leadek', en: 'My leads' },
  'title.leadDetail': { hu: 'Lead részletek', en: 'Lead details' },
  'title.wallet': { hu: 'Egyenleg és előzmények', en: 'Balance & history' },
  'title.settings': { hu: 'Beállítások', en: 'Settings' },
  'title.admin': { hu: 'Admin', en: 'Admin' },
  'chip.tokens': { hu: 'token', en: 'tokens' },
  'verify.banner': { hu: 'Erősítsd meg az e-mail címed a tokenköltéshez — az üdvözlő bónusz is ekkor jár.', en: 'Verify your email to spend tokens — your welcome bonus is granted on verification.' },
  'verify.resend': { hu: 'E-mail újraküldése', en: 'Resend email' },
  'verify.sent': { hu: 'Elküldve — nézd meg a postafiókod.', en: 'Sent — check your inbox.' },
  'buy.title': { hu: 'Nincs elég token', en: 'Not enough tokens' },
  'buy.subtitle': { hu: 'Tölts fel, és folytasd ott, ahol abbahagytad.', en: 'Top up and continue where you left off.' },
  'buy.close': { hu: 'Bezárás', en: 'Close' },
  'buy.buy': { hu: 'vásárlás', en: 'buy' },
  'common.save': { hu: 'Mentés', en: 'Save' },
  'common.cancel': { hu: 'Mégse', en: 'Cancel' },
  'common.delete': { hu: 'Törlés', en: 'Delete' },
  'common.loading': { hu: 'Betöltés…', en: 'Loading…' },
  'theme.toggle': { hu: 'Sötét mód', en: 'Dark mode' },
};

let currentLang: Lang = 'hu';
const listeners = new Set<() => void>();

function readLang(): Lang {
  if (typeof window === 'undefined') return 'hu';
  return (localStorage.getItem(KEY) === 'en' ? 'en' : 'hu');
}

export function setLang(lang: Lang) {
  currentLang = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); currentLang = readLang(); return () => listeners.delete(cb); },
    () => currentLang,
    () => 'hu' as Lang,
  );
}

export function t(key: string, lang: Lang): string {
  return DICT[key]?.[lang] ?? DICT[key]?.hu ?? key;
}
