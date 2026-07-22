'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp, Me } from '@/lib/store';
import { useLang, t } from '@/lib/i18n';
import { PRICING_DEFAULTS } from '@/lib/pricingShared';
import PurchaseModal from './PurchaseModal';
import Tour from './Tour';
import { IconGrid, IconSearch, IconBookmark, IconWallet, IconShield, IconLogout, IconCoin, IconSparkles, IconUsers } from './Icons';

interface MeResp { ok: boolean; user: Me; balance: number; }

function pageTitleKey(pathname: string): string {
  if (pathname === '/dashboard') return 'title.dashboard';
  if (pathname === '/leads') return 'title.leads';
  if (pathname === '/leads/unlocked') return 'title.myleads';
  if (pathname.startsWith('/leads/')) return 'title.leadDetail';
  if (pathname === '/wallet') return 'title.wallet';
  if (pathname === '/settings') return 'title.settings';
  if (pathname === '/admin') return 'title.admin';
  return 'title.dashboard';
}

// Theme boot: applied on mount (and persisted by the settings toggle).
function applyStoredTheme() {
  try {
    const stored = localStorage.getItem('tl_theme');
    const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch { /* SSR/no storage */ }
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { me, balance, setAuth, clear } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const lang = useLang();
  const [resent, setResent] = useState('');
  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => { applyStoredTheme(); }, []);

  useEffect(() => {
    if (isAuthPage) return;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MeResp | null) => (d?.ok ? setAuth(d.user, d.balance) : clear()))
      .catch(() => clear());
  }, [setAuth, clear, isAuthPage, pathname]);

  if (isAuthPage) return <>{children}</>;

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    clear();
    router.push('/login');
  }

  async function resend() {
    setResent('…');
    try {
      const r = await fetch('/api/auth/resend', { method: 'POST' });
      const d = await r.json();
      if (d.devVerifyUrl) setResent(`DEV: ${d.devVerifyUrl}`);
      else if (d.ok) setResent(t('verify.sent', lang));
      else setResent(d.error || 'hiba');
    } catch {
      setResent('hiba');
    }
  }

  const NAV = [
    { href: '/dashboard', label: t('nav.dashboard', lang), icon: IconGrid },
    { href: '/leads', label: t('nav.leads', lang), icon: IconSearch },
    { href: '/leads/unlocked', label: t('nav.myleads', lang), icon: IconBookmark },
    { href: '/wallet', label: t('nav.wallet', lang), icon: IconWallet },
    { href: '/settings', label: t('nav.settings', lang), icon: IconUsers },
  ];

  const lowBalance = me?.verified && balance < PRICING_DEFAULTS.LOW_BALANCE_THRESHOLD;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark"><IconSparkles size={18} /></span>
          <span className="brand-name">Token<b>Leads</b></span>
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`side-link ${pathname === href ? 'active' : ''}`}>
            <Icon size={18} /> {label}
          </Link>
        ))}
        {me?.role === 'admin' && (
          <Link href="/admin" className={`side-link ${pathname === '/admin' ? 'active' : ''}`}>
            <IconShield size={18} /> {t('nav.admin', lang)}
          </Link>
        )}
        <div className="side-bottom">
          <div className="side-user">
            <span className="avatar">{(me?.name || me?.email || '?').slice(0, 1).toUpperCase()}</span>
            <span className="em">{me?.email || ''}</span>
          </div>
          <button className="side-link" onClick={logout}><IconLogout size={18} /> {t('nav.logout', lang)}</button>
        </div>
      </aside>

      <div className="main">
        {me && !me.verified && (
          <div className="banner" role="status">
            <span>✉️ {t('verify.banner', lang)}</span>
            <button className="btn ghost sm" onClick={resend} disabled={resent === '…'}>{t('verify.resend', lang)}</button>
            {resent && resent !== '…' && (
              resent.startsWith('DEV: ')
                ? <a href={resent.slice(5)} style={{ fontSize: 12 }}>dev-verifikáció megnyitása →</a>
                : <span className="muted" style={{ fontSize: 12 }}>{resent}</span>
            )}
          </div>
        )}
        <div className="topbar">
          <h1>{t(pageTitleKey(pathname), lang)}</h1>
          <div className="spacer" />
          <Link href="/wallet" className={`chip ${lowBalance ? 'low' : ''}`}
            title={lowBalance ? 'Alacsony egyenleg — tölts fel!' : 'Token egyenleg'}>
            <IconCoin size={16} /> {balance} {t('chip.tokens', lang)}
          </Link>
        </div>
        <div className="content">{children}</div>
      </div>

      <PurchaseModal />
      <Tour />
    </div>
  );
}
