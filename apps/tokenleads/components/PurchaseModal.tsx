'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { api } from '@/lib/clientApi';
import { useLang, t } from '@/lib/i18n';
import { PACKAGES } from '@/lib/pricingShared';
import { IconCoin } from './Icons';

// Global top-up modal — opened automatically on any 402, or from the UI.
// Stripe mode returns a checkout URL; mock mode credits instantly.
export default function PurchaseModal() {
  const { buyOpen, setBuyOpen } = useApp();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const lang = useLang();

  if (!buyOpen) return null;

  async function buy(packageId: string) {
    setBusy(packageId); setNotice('');
    try {
      const d = await api<{ url?: string; balance?: number; mock?: boolean }>('/api/wallet/purchase', {
        method: 'POST', body: JSON.stringify({ packageId }),
      });
      if (d.url) {
        location.href = d.url; // Stripe Checkout
        return;
      }
      setNotice(`+ jóváírva (teszt-mód) — új egyenleg: ${d.balance} token`);
      setTimeout(() => setBuyOpen(false), 1200);
    } catch {
      setNotice('Hiba a vásárlásnál, próbáld újra.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBuyOpen(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('buy.title', lang)}>
        <h2>{t('buy.title', lang)}</h2>
        <p className="sub">{t('buy.subtitle', lang)}</p>
        {notice && <div className="notice ok">{notice}</div>}
        <div className="cards" style={{ margin: 0 }}>
          {PACKAGES.map((p) => (
            <div className="card" key={p.id} style={{ textAlign: 'center' }}>
              <div className="k">{p.label}</div>
              <div className="v" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {p.tokens} <IconCoin size={18} />
              </div>
              <button className="btn sm" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => buy(p.id)}>
                {busy === p.id ? '…' : `$${(p.priceCents / 100).toFixed(2)} — ${t('buy.buy', lang)}`}
              </button>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button className="btn ghost sm" onClick={() => setBuyOpen(false)}>{t('buy.close', lang)}</button>
        </div>
      </div>
    </div>
  );
}
