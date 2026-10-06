'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { UnknownSendRow } from '@/lib/api';

// Emails of unknown fate. A send round died right around handing an email to
// the mail server, so nobody knows whether it went out. A machine must not send
// it again on a guess, so each one waits here for a person: look in the
// sender's Sent folder, then say which it was. Shows nothing when there is none.
export default function UnknownSends() {
  const [rows, setRows] = useState<UnknownSendRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.getUnknownSends()
      .then((r) => { if (r.ok) { setRows(r.sends || []); setError(''); } else setError(r.error || 'The emails waiting for a decision could not be loaded.'); })
      .catch(() => setError('The emails waiting for a decision could not be loaded.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (row: UnknownSendRow, decision: 'sent' | 'resend') => {
    setBusy(row.id);
    try {
      const r = await api.settleUnknownSend(row.id, decision);
      if (!r.ok) setError(r.error || 'The decision could not be saved.');
      load();
    } catch {
      setError('Network error. Nothing was changed.');
    } finally {
      setBusy('');
    }
  };

  if (!rows.length && !error) return null;
  return (
    <div className="oseq-card">
      <div className="oseq-row">
        <b>Emails that may or may not have gone out</b>
        <span className="chip red">{rows.length}</span>
        <span className="muted">Check the sender's Sent folder, then decide. Nothing is sent again by itself.</span>
      </div>
      {error && <div className="oseq-note bad">{error} <button className="mini" onClick={load}>Try again</button></div>}
      {rows.map((r) => (
        <div key={r.id} className="oseq-row">
          <span>{r.name || 'A lead'} &lt;{r.to}&gt;</span>
          <span className="muted">{r.sentAt ? new Date(r.sentAt).toLocaleString() : ''}</span>
          <div className="spacer" />
          <button className="mini" onClick={() => decide(r, 'sent')} disabled={!!busy} title="It is in the Sent folder: the lead moves on to its next step.">{busy === r.id ? 'Saving…' : 'It was sent'}</button>
          <button className="mini" onClick={() => decide(r, 'resend')} disabled={!!busy} title="It is not in the Sent folder: the step becomes due again.">Send it again</button>
        </div>
      ))}
    </div>
  );
}
