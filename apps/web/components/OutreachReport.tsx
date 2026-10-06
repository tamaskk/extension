'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { OutreachReportData, ReportRow } from '@/lib/api';

// Report tab: what went out and what became of it, as far as SMTP lets it be
// known. There is no "delivered" event and no way to see a spam folder or a
// complaint, and the screen says so where a number could be mistaken for one.

const PERIODS: [number, string][] = [[7, '7 days'], [30, '30 days'], [0, 'All time']];
const pct = (r: number | null) => (r === null ? '' : `${(r * 100).toFixed(1).replace(/\.0$/, '')} %`);
const COLOR: Record<string, string> = { ok: 'green', warn: 'amber', bad: 'red' };

// A share with its count. Below the sample limit only the count is shown: 3 of 20 is 3, not "15 %".
function Share({ n, rate, level, limit }: { n: number; rate: number | null; level?: string; limit?: number }) {
  if (rate === null) return <span>{n.toLocaleString()}</span>;
  return (
    <span className="orep-share">
      <span className={`chip ${level ? COLOR[level] || 'gray' : 'gray'}`} title={limit !== undefined ? `Limit: ${pct(limit)}` : undefined}>{pct(rate)}</span>
      <span className="muted">{n.toLocaleString()}</span>
      {limit !== undefined && <span className="orep-bar" aria-hidden="true"><span className={`orep-fill ${level || 'ok'}`} style={{ width: `${Math.min(100, (rate / limit) * 50)}%` }} /><span className="orep-mark" /></span>}
    </span>
  );
}

function Table({ title, note, rows, limits, withSequence }: { title: string; note?: string; rows: ReportRow[]; limits: { bounce: number; block: number }; withSequence?: boolean }) {
  return (
    <div className="oseq-card">
      <div className="oseq-row"><b>{title}</b>{note && <span className="muted">{note}</span>}</div>
      {!rows.length && <div className="muted oseq-hint">Nothing in this period.</div>}
      {rows.length > 0 && (
        <div className="orep-table">
          <div className="orep-tr orep-th"><span /><span>Accepted</span><span>Bounced</span><span>Blocked</span><span>Replied</span><span>Stop</span></div>
          {rows.map((r) => (
            <div key={r.id} className={`orep-tr ${r.variant ? 'orep-variant' : ''}`}>
              <span>{withSequence && r.sequence ? <><span className="muted">{r.sequence} · </span>{r.label}</> : r.label}{!r.enough && <span className="chip gray orep-few">too few to rate</span>}</span>
              <span>{r.sent.toLocaleString()}</span>
              <Share n={r.bounced} rate={r.rates.bounce} level={r.levels.bounce} limit={limits.bounce} />
              <Share n={r.blocked} rate={r.rates.block} level={r.levels.block} limit={limits.block} />
              <Share n={r.replied} rate={r.rates.reply} />
              <Share n={r.stopped} rate={r.rates.stop} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OutreachReport() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<OutreachReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [spam, setSpam] = useState('');
  const [spamDate, setSpamDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = useCallback((d: number) => {
    setLoading(true);
    api.getOutreachReport(d)
      .then((r) => { if (r.ok) { setData(r); setError(''); } else setError(r.error || 'The report could not be built.'); })
      .catch(() => setError('The report could not be built.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(days); }, [load, days]);

  const savePostmaster = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const r = await api.saveControl({ postmaster: { spamRate: spam, date: spamDate } });
      if (!r.ok) { setSaveMsg(r.error || 'That could not be saved.'); return; }
      setSpam(''); setSaveMsg('Saved.');
      load(days);
    } catch {
      setSaveMsg('Network error. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const t = data?.total;
  const limits = data?.thresholds || { bounce: 0.02, block: 0.01 };
  const pm = data?.postmaster;

  return (
    <div className="groups-wrap">
      <div className="groups-bar">
        <div className="groups-title">📈 Report</div>
        <div className="spacer" />
        {PERIODS.map(([d, label]) => <button key={d} className={`chipbtn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{label}</button>)}
        <button className="btn" onClick={() => load(days)} disabled={loading}>⟳ Refresh</button>
      </div>
      {loading && !data && <div className="empty">Loading…</div>}
      {!loading && error && <div className="empty">{error} <button className="mini" onClick={() => load(days)}>Try again</button></div>}
      {data && t && !error && (
        <>
          <div className="log-tiles">
            <div className="log-tile"><div className="log-tile-n">{t.sent.toLocaleString()}</div>Accepted by our mail server. Not the same as delivered.</div>
            <div className="log-tile"><div className="log-tile-n">{t.assumedDelivered.toLocaleString()}</div>Assumed delivered: an estimate, accepted minus what came back. Inbox or spam cannot be told.</div>
            <div className="log-tile"><div className={`log-tile-n ${t.levels.bounce === 'bad' ? 'red' : t.levels.bounce === 'warn' ? 'amber' : ''}`}>{t.rates.bounce === null ? t.bounced.toLocaleString() : pct(t.rates.bounce)}</div>Bounced for good ({t.bounced.toLocaleString()}). Limit {pct(limits.bounce)}. {t.soft > 0 && `${t.soft.toLocaleString()} more bounced for now.`}</div>
            <div className="log-tile"><div className={`log-tile-n ${t.levels.block === 'bad' ? 'red' : t.levels.block === 'warn' ? 'amber' : ''}`}>{t.rates.block === null ? t.blocked.toLocaleString() : pct(t.rates.block)}</div>Blocked by the receiving server ({t.blocked.toLocaleString()}). Limit {pct(limits.block)}. The cure is less volume.</div>
            <div className="log-tile"><div className="log-tile-n green">{t.rates.reply === null ? t.replied.toLocaleString() : pct(t.rates.reply)}</div>Replied ({t.replied.toLocaleString()}). The real figure is higher: a call back or a reply from another address is not seen.</div>
            <div className="log-tile"><div className="log-tile-n">{t.stopped.toLocaleString()}</div>Asked to stop</div>
          </div>
          {!t.enough && <div className="oseq-note">Fewer than {data.minSample} emails in this period, so shares are not shown, only counts: 3 bounces out of 20 are 3 bounces, not a rate.</div>}
          {t.unknown > 0 && <div className="oseq-note">{t.unknown} {t.unknown === 1 ? 'email' : 'emails'} may or may not have gone out and {t.unknown === 1 ? 'waits' : 'wait'} for a decision on the Sequences tab.</div>}
          {(data.seeds || 0) > 0 && <div className="muted oseq-hint">{data.seeds} seed test {data.seeds === 1 ? 'email' : 'emails'} to our own mailboxes in this period, left out of every number above.</div>}

          <div className="oseq-card">
            <div className="oseq-row">
              <b>Spam rate from Google Postmaster Tools</b>
              {pm && pm.spamRate !== null
                ? <span className={`chip ${pm.stale ? 'red' : 'gray'}`}>{pm.spamRate} % as of {pm.date}{pm.days !== null ? `, ${pm.days} ${pm.days === 1 ? 'day' : 'days'} ago` : ''}{pm.stale ? ': too old' : ''}</span>
                : <span className="chip red">Never entered</span>}
            </div>
            <div className="muted oseq-hint">Nobody tells a sender when a recipient presses "spam". This figure, read by hand, is the only outside sign of what Gmail makes of the emails. Sending stops when it is older than 14 days.</div>
            <form className="oseq-row" onSubmit={savePostmaster}>
              <label className="orep-inline">Spam rate, in percent <input className="search" inputMode="decimal" value={spam} onChange={(e) => setSpam(e.target.value)} placeholder="0.1" /></label>
              <label className="orep-inline">Read on <input className="search" type="date" value={spamDate} onChange={(e) => setSpamDate(e.target.value)} /></label>
              <button className="btn" type="submit" disabled={saving || !spam.trim()}>{saving ? 'Saving…' : 'Save'}</button>
              {saveMsg && <span className="muted">{saveMsg}</span>}
            </form>
          </div>

          <Table title="By step" note="Where a sequence loses people. Wording variants are listed under their step." rows={data.byStep || []} limits={limits} withSequence />
          <Table title="By sender" note="Which account is close to a limit." rows={data.bySender || []} limits={limits} />
          <Table title="By offer" note="AI automation against social media, sequence emails only." rows={data.byOffer || []} limits={limits} />
        </>
      )}
    </div>
  );
}
