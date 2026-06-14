'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useGrid } from '@/lib/store';

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const doImport = async (raw: string) => {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { setResult('❌ Invalid JSON — check the file/text.'); return; }
    setBusy(true); setResult('Importing…');
    try {
      const res = await api.sync(data);
      await useGrid.getState().hydrate();
      if (res && res.ok) {
        const skipped = res.skippedDuplicates ? `, ${res.skippedDuplicates} cross-project duplicate(s) skipped` : '';
        setResult(`✓ Imported ${res.projects} project(s), ${res.added ?? 0} new lead(s)${skipped}.`);
      } else {
        setResult('❌ Not a valid GridLeads export (need a { projects: … } JSON).');
      }
    } catch {
      setResult('❌ Import failed (server error).');
    }
    setBusy(false);
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-sm">
        <div className="modal-head">
          <div>
            <div className="modal-title">⤴ Import JSON</div>
            <div className="modal-sub">Load a GridLeads export (the .json you get from Export). It merges into the database — nothing is deleted.</div>
          </div>
          <button className="btn" onClick={onClose}>✕ Close</button>
        </div>
        <div className="modal-body">
          <button className="btn primary import-choose" onClick={() => fileRef.current?.click()}>📁 Choose JSON file…</button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await doImport(await f.text()); e.target.value = ''; }}
          />
          <div className="import-or">— or paste JSON below —</div>
          <textarea className="import-text" placeholder='{"gridleads":1,"projects":{ ... }}' value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary import-go" disabled={busy} onClick={() => { const t = text.trim(); if (!t) { setResult('Paste JSON or choose a file first.'); return; } doImport(t); }}>⬆ Import</button>
          <div className="import-result">{result}</div>
        </div>
      </div>
    </div>
  );
}
