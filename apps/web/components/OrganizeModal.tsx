'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { OrganizeRoot, OrganizeSub } from '@/lib/api';

type Preview = Awaited<ReturnType<typeof api.organize>>;

const fmtDate = (s: string) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

export default function OrganizeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set()); // expanded root/sub keys

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.organize({ dryRun: true })
      .then((r) => { if (!cancelled) { if (r.ok) { setPreview(r); setOpen(new Set(r.plan.roots.map((x) => 'r:' + x.name))); } else setError(r.error || 'Preview failed'); } })
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

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allKeys = (p: Preview) => { const ks: string[] = []; for (const r of p.plan.roots) { ks.push('r:' + r.name); for (const sub of r.subs) ks.push('s:' + r.name + '/' + sub.name); } return ks; };

  const p = done || preview;
  const nothingToDo = !!p && !p.foldersCreated.length && !p.foldersReparented && !p.projectsMoved;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <div className="modal-title">🗂 Organize projects into folders</div>
            <div className="modal-sub">
              {loading ? 'Analyzing…'
                : done ? '✓ Done — your folders are organized.'
                : 'Preview of exactly what goes where. Expand any folder to verify before applying. Nothing is deleted.'}
            </div>
          </div>
          <div className="modal-actions">
            {p && !nothingToDo && (
              <>
                <button className="btn" onClick={() => setOpen(new Set(allKeys(p)))}>⊕ Expand all</button>
                <button className="btn" onClick={() => setOpen(new Set())}>⊖ Collapse</button>
              </>
            )}
            {!done && !nothingToDo && (
              <button className="btn primary" onClick={apply} disabled={loading || applying || !preview}>
                {applying ? '⏳ Organizing…' : '✓ Apply'}
              </button>
            )}
            <button className="btn" onClick={onClose}>{done ? '✕ Close' : 'Cancel'}</button>
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="empty" style={{ color: '#f87171', padding: 16 }}>⚠ {error}</div>}
          {loading ? <div className="muted" style={{ padding: 24 }}>Computing the reorg plan…</div>
            : !p ? null
            : nothingToDo ? <div className="empty" style={{ padding: 24 }}>✓ Everything is already organized — nothing to change.</div>
            : (
              <div className="org-plan">
                <div className="org-stats">
                  <Stat n={p.projectsMoved} label="projects moved" />
                  <Stat n={p.foldersCreated.length} label="folders created" />
                  <Stat n={p.foldersReparented} label="folders re-nested" />
                  <Stat n={p.unmatched} label="left as-is (unknown region)" muted />
                </div>

                <div className="org-tree">
                  {p.plan.roots.map((root) => (
                    <RootNode key={root.name} root={root} open={open} toggle={toggle} />
                  ))}
                </div>

                {p.sampleUnmatched.length > 0 && (
                  <div className="org-section" style={{ marginTop: 16 }}>
                    <div className="org-section-title">Left untouched — region not recognized (showing {p.sampleUnmatched.length} of {p.unmatched})</div>
                    <div className="org-section-body">
                      {p.sampleUnmatched.map((q) => <span key={q} className="org-chip muted">{q}</span>)}
                    </div>
                  </div>
                )}

                {!done && (
                  <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                    Nothing is deleted — every folder is kept (even if it ends up empty) and no project is removed.
                    Already-correct folders are reused (matched case/accent-insensitively); projects with an
                    unrecognized region stay exactly where they are.
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function RootNode({ root, open, toggle }: { root: OrganizeRoot; open: Set<string>; toggle: (k: string) => void }) {
  const k = 'r:' + root.name;
  const isOpen = open.has(k);
  return (
    <div className="org-node">
      <div className="org-row org-row-root" onClick={() => toggle(k)}>
        <span className="org-caret">{root.subs.length ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span className="org-name">{root.icon || '📁'} {root.name}</span>
        {root.created && <span className="org-tag add">NEW</span>}
        <span className="org-meta">{root.subs.length} subfolder{root.subs.length === 1 ? '' : 's'}{root.movedCount ? ` · +${root.movedCount} moving in` : ''}</span>
      </div>
      {isOpen && root.subs.map((sub) => <SubNode key={sub.name} root={root.name} sub={sub} open={open} toggle={toggle} />)}
    </div>
  );
}

function SubNode({ root, sub, open, toggle }: { root: string; sub: OrganizeSub; open: Set<string>; toggle: (k: string) => void }) {
  const k = 's:' + root + '/' + sub.name;
  const isOpen = open.has(k);
  const hasMoves = sub.moved.length > 0;
  return (
    <div className="org-node org-node-sub">
      <div className={`org-row org-row-sub ${hasMoves ? '' : 'static'}`} onClick={() => hasMoves && toggle(k)}>
        <span className="org-caret">{hasMoves ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span className="org-name">📂 {sub.name}</span>
        <span className={`org-tag ${sub.status === 'created' ? 'add' : sub.status === 'reparented' ? 'move' : 'keep'}`}>
          {sub.status === 'created' ? 'NEW' : sub.status === 'reparented' ? `re-nested${sub.fromParent ? ` from ${sub.fromParent}` : ''}` : 'existing'}
        </span>
        <span className="org-meta">
          {sub.movedCount ? `+${sub.movedCount} moving in` : 'no project moves'}
          {sub.alreadyHere ? ` · ${sub.alreadyHere} already here` : ''}
        </span>
      </div>
      {isOpen && hasMoves && (
        <div className="org-moves">
          {sub.moved.map((m) => (
            <div key={m.query} className="org-move">
              <span className="org-move-q">{m.query}</span>
              <span className="org-move-from">from {m.from}</span>
              <span className="org-move-date">{fmtDate(m.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
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
