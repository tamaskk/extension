'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/clientApi';
import { useApp } from '@/lib/store';

const STEPS = [
  {
    title: 'Üdv a TokenLeadsben! 👋',
    body: 'Több mint 1 millió minősített B2B lead vár. Tokenekkel fizetsz — csak azért, amit tényleg használsz.',
    cta: 'Mutasd, hogy működik', href: null,
  },
  {
    title: '1. Keress rá a célpiacodra',
    body: 'A Lead keresőben kategória, város, értékelés és weboldal-státusz szerint szűrhetsz. Egy keresés-oldal 1 token, és 24 óráig ingyen újranyitható.',
    cta: 'Tovább', href: '/leads',
  },
  {
    title: '2. Oldd fel, ami ígéretes',
    body: 'A lead teljes adata 2, a kontakt (telefon, e-mail, weboldal) 5 token. Amit feloldasz, örökre a tiéd — jegyzetelhetsz és státuszt is állíthatsz rajta.',
    cta: 'Tovább', href: null,
  },
  {
    title: '3. Kövesd az egyenleged',
    body: 'Minden token-mozgást látsz az Egyenleg oldalon. Ha elfogy, csomagot vehetsz, vagy meghívhatsz egy ismerőst — mindketten bónuszt kaptok.',
    cta: 'Kezdés', href: null,
  },
];

export default function Tour() {
  const { me, setAuth, balance } = useApp();
  const [step, setStep] = useState(0);
  const [gone, setGone] = useState(false);
  const router = useRouter();

  if (!me || me.onboarded || gone) return null;

  async function finish() {
    setGone(true);
    if (me) setAuth({ ...me, onboarded: true }, balance);
    api('/api/auth/onboarded', { method: 'POST' }).catch(() => {});
  }

  function next() {
    const target = STEPS[step].href;
    if (target) router.push(target);
    if (step >= STEPS.length - 1) void finish();
    else setStep(step + 1);
  }

  const s = STEPS[step];
  return (
    <div className="tour-card" role="dialog" aria-label="Bemutató">
      <div className="tour-step">{step + 1} / {STEPS.length}</div>
      <h3>{s.title}</h3>
      <p>{s.body}</p>
      <div className="row">
        <button className="btn sm" onClick={next}>{s.cta}</button>
        <button className="btn ghost sm" onClick={finish}>Kihagyom</button>
      </div>
    </div>
  );
}
