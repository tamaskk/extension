'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SequencePreview } from '@/lib/api';
import { withFooter } from '@/lib/outreachFooter.mjs';

// The emails of a sequence as one lead would get them: variables filled in and
// the footer attached, exactly the text that leaves. Read-only. Without a lead
// it shows a real one from the database, and "Another lead" moves on.

interface Props {
  sequenceId: string; sequenceName: string; language: string;
  lead?: { project: string; dedupKey: string };
  onClose: () => void;
}

export default function EmailPreviewModal({ sequenceId, sequenceName, language, lead, onClose }: Props) {
  const [preview, setPreview] = useState<SequencePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skip, setSkip] = useState(0);

  const load = useCallback((n: number) => {
    setLoading(true);
    api.previewSequence(sequenceId, lead ? { project: lead.project, dedupKey: lead.dedupKey } : { skip: n })
      .then((r) => { if (r.ok) { setPreview(r); setError(''); } else setError(r.error || 'The preview could not be made.'); })
      .catch(() => setError('The preview could not be made.'))
      .finally(() => setLoading(false));
  }, [sequenceId, lead]);
  useEffect(() => { load(skip); }, [load, skip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps = preview?.steps || [];
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Email preview">
        <div className="modal-head">
          <div>
            <div className="modal-title">✉️ {sequenceName}</div>
            <div className="modal-sub">{preview?.lead ? `To ${preview.lead.name || 'a lead without a name'} <${preview.lead.email || 'no email'}>` : 'What a lead gets, with the footer.'}</div>
          </div>
          <div className="modal-actions">
            {!lead && <button className="btn" onClick={() => setSkip((n) => n + 1)} disabled={loading}>Another lead</button>}
            <button className="btn" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="modal-body">
          {loading && !preview && <div className="empty">Loading…</div>}
          {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load(skip)}>Try again</button></div>}
          {preview && !error && !steps.length && <div className="empty">No step of this sequence is switched on.</div>}
          {preview && !error && steps.map((p, n) => (
            <div key={p.id} className="oseq-mail">
              <div className="oseq-row">
                <b>Email {n + 1}</b>
                <span className="muted">{n === 0 ? 'the opening email' : `day ${p.day ?? '?'}, a follow-up`}</span>
                {p.unknown.length > 0 && <span className="chip red">Not a variable: {p.unknown.join(', ')}</span>}
                {p.missing.length > 0 && <span className="chip amber">This lead has no {p.missing.join(', ')}</span>}
              </div>
              <div className="oseq-subject">{p.sameThread && n > 0 ? 'In the thread of the first email' : p.subject || 'No subject'}</div>
              <pre className="wp-text">{withFooter(p.body, language)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
