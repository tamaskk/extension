'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { MailLogData, MailLogRow } from '@/lib/api';
import type { OutreachSequenceRow } from '@/lib/types';
import EmailPreviewModal from './EmailPreviewModal';

// "All mail" in the Replies tab: every email GridLeads sent and every message
// its mailbox watcher read, over all sender accounts or one, newest first.

const STATE: Record<string, { cls: string; text: string }> = {
  // sent emails
  sent: { cls: 'green', text: 'sent' }, delivered: { cls: 'green', text: 'delivered' }, replied: { cls: 'blue', text: 'replied' },
  sending: { cls: 'amber', text: 'sending' }, unknown: { cls: 'amber', text: 'unknown' }, failed: { cls: 'red', text: 'refused' },
  bounced: { cls: 'red', text: 'bounced' }, blocked: { cls: 'red', text: 'blocked' }, complained: { cls: 'red', text: 'complaint' }, stopped: { cls: 'gray', text: 'asked to stop' },
  // arrived messages
  human: { cls: 'blue', text: 'reply' }, auto: { cls: 'gray', text: 'automatic' }, bounce: { cls: 'red', text: 'bounce notice' }, stop: { cls: 'pink', text: 'stop request' },
};
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

export default function MailLog() {
  const [data, setData] = useState<MailLogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sender, setSender] = useState('');
  const [dir, setDir] = useState<'' | 'out' | 'in'>('');
  const [open, setOpen] = useState<number | null>(null); // the row whose text is shown
  const [sequences, setSequences] = useState<OutreachSequenceRow[]>([]);
  const [preview, setPreview] = useState<MailLogRow | null>(null);

  const load = useCallback((s: string) => {
    setLoading(true); setOpen(null);
    api.getMailLog(s)
      .then((r) => { if (r.ok) { setData(r); setError(''); } else setError(r.error || 'The mail log could not be loaded.'); })
      .catch(() => setError('The mail log could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(sender); }, [load, sender]);
  // the sequences' names and languages, for the preview of a sent email; the list works without them
  useEffect(() => { api.getSequences().then((r) => { if (r.ok && r.sequences) setSequences(r.sequences); }).catch(() => setSequences([])); }, []);

  const senderName = useMemo(() => new Map((data?.senders || []).map((s) => [s.senderId, s.label])), [data]);
  const rows = (data?.rows || []).filter((r) => !dir || r.dir === dir);
  const sent = (data?.rows || []).filter((r) => r.dir === 'out').length;
  const previewSeq = preview ? sequences.find((s) => s.sequenceId === preview.sequenceId) : undefined;

  return (
    <>
      {preview && previewSeq && <EmailPreviewModal sequenceId={previewSeq.sequenceId} sequenceName={previewSeq.name} language={previewSeq.language} lead={{ project: preview.project, dedupKey: preview.dedupKey }} onClose={() => setPreview(null)} />}
      <div className="oseq-row">
        <select className="select" value={sender} onChange={(e) => setSender(e.target.value)} aria-label="Sender account">
          <option value="">Every account</option>
          {(data?.senders || []).map((s) => <option key={s.senderId} value={s.senderId}>{s.label} ({s.fromEmail})</option>)}
        </select>
        {([['', 'Both'], ['out', 'Sent'], ['in', 'Received']] as const).map(([key, label]) => <button key={key} className={`chipbtn ${dir === key ? 'active' : ''}`} onClick={() => setDir(key)}>{label}</button>)}
        <div className="spacer" />
        {data?.rows && <span className="muted">{sent.toLocaleString()} sent · {(data.rows.length - sent).toLocaleString()} received{data.capped ? ' · the newest 300 of each' : ''}</span>}
        <button className="btn" onClick={() => load(sender)} disabled={loading}>⟳ Refresh</button>
      </div>
      <div className="muted oseq-hint">What GridLeads sent and what its mailbox watcher read. Emails written by hand in Gmail are not here, and neither is mail from before an account was added.</div>

      {loading && !data && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load(sender)}>Try again</button></div>}
      {data && !error && !rows.length && <div className="empty">{dir === 'in' ? 'Nothing has arrived yet.' : dir === 'out' ? 'Nothing has been sent yet.' : 'No mail yet.'}</div>}
      {data && !error && rows.length > 0 && (
        <div className="orep-table">
          <div className="omail-tr orep-th"><span>When</span><span /><span>Account</span><span>With</span><span>What</span><span>State</span></div>
          {rows.map((r, n) => {
            const st = STATE[r.state] || { cls: 'gray', text: r.state || 'unknown' };
            const canPreview = r.dir === 'out' && !!r.sequenceId && !!r.dedupKey;
            const hasText = !!r.note;
            return (
              <div key={`${r.dir}:${r.at}:${r.address}:${n}`}>
                <div className="omail-tr">
                  <span className="muted">{when(r.at)}</span>
                  <span className={`chip ${r.dir === 'out' ? 'gray' : 'blue'}`} title={r.dir === 'out' ? 'Sent' : 'Received'}>{r.dir === 'out' ? '↑ out' : '↓ in'}</span>
                  <span className="muted">{senderName.get(r.senderId) || r.senderId}</span>
                  <span title={r.address}>{r.leadName ? <>{r.leadName} <span className="muted">· {r.address}</span></> : r.address}</span>
                  <span title={r.title}>
                    {r.title}
                    {canPreview && <> <button className="mini" onClick={() => setPreview(r)}>Text</button></>}
                    {!canPreview && hasText && <> <button className="mini" onClick={() => setOpen(open === n ? null : n)}>{open === n ? 'Hide' : 'Text'}</button></>}
                  </span>
                  <span><span className={`chip ${st.cls}`}>{st.text}</span>{r.ignored && <span className="muted" title={r.ignored}> · no effect</span>}</span>
                </div>
                {open === n && <pre className="wp-text omail-text">{r.note}</pre>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
