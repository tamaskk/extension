'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Preview = Awaited<ReturnType<typeof api.organize>>;

export default function OrganizeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Preview | null>(null);

  // run a dry-run preview on open
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.organize({ dryRun: true })
      .then((r) => { if (!cancelled) { if (r.ok) setPreview(r); else setError(r.error || 'Preview failed'); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Preview failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const apply = async () => {
    setApplying(true); setError(null);
    try {
      const r = await api.organize({ dryRun: false });
      if (!r.ok) { setError(r.error || 'Organize failed'); return; }
      setDone(r);
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Organize failed');
    } finally {
      setApplying(false);
    }
  };

  const p = done || preview;
  const nothingToDo = !!p && !p.foldersCreated.length && !p.foldersReparented && !p.projectsMoved && !p.foldersDeleted.length;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗂 Organize projects into folders</div>
            <div className="modal-sub">
              {loading ? 'Analyzing…'
                : done ? '✓ Done — your folders are organized.'
                : 'Files every project into “<region> <vertical>” and nests it under “<country> <vertical>”. Review before applying.'}
            </div>
          </div>
          <div className="modal-actions">
            {!done && !nothingToDo && (
              <button className="btn primary" onClick={apply} disabled={loading || applying || !preview}>
                {applying ? '⏳ Organizing…' : '✓ Apply'}
              </button>
            )}
            <button className="btn" onClick={onClose}>{done ? '✕ Close' : 'Cancel'}</button>
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="empty" style={{ color: 'var(--danger, #e23b3b)', padding: 16 }}>⚠ {error}</div>}
          {loading ? <div className="muted" style={{ padding: 24 }}>Computing the reorg plan…</div>
            : !p ? null
            : nothingToDo ? <div className="empty" style={{ padding: 24 }}>✓ Everything is already organized — nothing to change.</div>
            : (
              <div className="org-plan">
                <div className="org-stats">
                  <Stat n={p.projectsMoved} label="projects moved" />
                  <Stat n={p.foldersCreated.length} label="folders created" />
                  <Stat n={p.foldersReparented} label="folders re-nested" />
                  <Stat n={p.foldersDeleted.length} label="empty folders removed" />
                  <Stat n={p.unmatched} label="left as-is (unknown region)" muted />
                </div>

                {p.foldersCreated.length > 0 && (
                  <Section title={`New folders (${p.foldersCreated.length})`}>
                    {p.foldersCreated.map((n) => <span key={n} className="org-chip add">+ {n}</span>)}
                  </Section>
                )}
                {p.foldersDeleted.length > 0 && (
                  <Section title={`Removed empty folders (${p.foldersDeleted.length})`}>
                    {p.foldersDeleted.map((n) => <span key={n} className="org-chip del">– {n}</span>)}
                  </Section>
                )}
                {p.sampleUnmatched.length > 0 && (
                  <Section title={`Left untouched — region not recognized (showing ${p.sampleUnmatched.length} of ${p.unmatched})`}>
                    {p.sampleUnmatched.map((q) => <span key={q} className="org-chip muted">{q}</span>)}
                  </Section>
                )}

                {!done && (
                  <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                    Already-correct folders are kept (matched case/accent-insensitively); only typos, duplicates and
                    misplaced folders are consolidated. Projects with an unrecognized region stay exactly where they are.
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, muted }: { n: number; label: string; muted?: boolean }) {
  return (
    <div className={`org-stat ${muted ? 'muted' : ''}`}>
      <div className="org-stat-n">{n.toLocaleString()}</div>
      <div className="org-stat-l">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="org-section">
      <div className="org-section-title">{title}</div>
      <div className="org-section-body">{children}</div>
    </div>
  );
}
