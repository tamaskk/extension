'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  LOCK_MARGIN_MS, REQUEST_TIMEOUT_MS,
  appendLog, backoffDelay, lockIsFree, longestGapMs, nextDelay,
} from '@/lib/outreachRunner.mjs';

// The tab that keeps the outreach loop alive: it is left open around the clock
// and calls POST /api/outreach/tick. It only schedules. What goes out, and
// whether anything goes out at all, is decided by the route on every call.

const LOCK_KEY = 'gridleads_orun_lock';
const LOG_KEY = 'gridleads_orun_log';
// A second tab on this page does not call the route; it looks again this often.
const LOCK_RETRY_MS = 30_000;
// The watchdog limit: a pause longer than this means the loop was dead.
const GAP_LIMIT_MS = 10 * 60_000;
const SHOWN_ROWS = 50;
// The mailboxes are read from the same chain, far less often than a send round.
const INBOX_EVERY_MS = 4 * 60_000;
// Up to this much is added to every wait, at random: without it the rounds, and
// so the emails, would leave on a fixed beat that reads as a machine.
const JITTER_MS = 20_000;

interface TickEntry { at: number; ok: boolean; action: string; reason: string; sentToday: number; ms: number }
interface RunnerLock { id: string; until: number }

// localStorage can be missing or blocked (private window, cleared site data).
// The loop must run without it, so a failed read is the fallback and a failed
// write is only reported.
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`outreach runner: could not store ${key}`, e);
  }
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString();

export default function OutreachRunner() {
  const [log, setLog] = useState<TickEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failures, setFailures] = useState(0);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const logRef = useRef<TickEntry[]>([]);

  useEffect(() => {
    const tabId = Math.random().toString(36).slice(2);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failed = 0;
    let lastInboxAt = 0;

    logRef.current = readStored<TickEntry[]>(LOG_KEY, []);
    setLog(logRef.current);

    // A setTimeout chain, not setInterval: the next round is planned only after
    // the previous one answered, so two rounds can never overlap.
    const schedule = (ms: number) => {
      setNextAt(Date.now() + ms);
      timer = setTimeout(tick, ms);
    };

    async function tick() {
      const startedAt = Date.now();
      if (!lockIsFree(readStored<RunnerLock | null>(LOCK_KEY, null), tabId, startedAt)) {
        setBlocked(true);
        setStarted(true);
        schedule(LOCK_RETRY_MS);
        return;
      }
      setBlocked(false);
      writeStored(LOCK_KEY, { id: tabId, until: startedAt + REQUEST_TIMEOUT_MS + LOCK_MARGIN_MS });

      let entry: TickEntry;
      let delay: number;
      try {
        const r = await api.outreachTick(REQUEST_TIMEOUT_MS);
        // A shut gate is an answer, not a failure: the loop is alive, sending is not allowed.
        if (!r.ok && !r.blocked) throw new Error(r.error || 'The server answered with an error');
        failed = 0;
        entry = { at: startedAt, ok: true, action: r.blocked ? 'blocked' : r.action || 'skip', reason: r.reason || '', sentToday: Number(r.sentToday) || 0, ms: Date.now() - startedAt };
        delay = nextDelay(r.nextInMs) + Math.floor(Math.random() * JITTER_MS);
      } catch (e) {
        // A failed round never ends the chain: wait longer and ask again.
        failed += 1;
        const last = logRef.current[logRef.current.length - 1];
        entry = { at: startedAt, ok: false, action: 'error', reason: e instanceof Error ? e.message : 'Request failed', sentToday: last ? last.sentToday : 0, ms: Date.now() - startedAt };
        delay = backoffDelay(failed);
      }
      // Bounces, replies and stop requests come in as mail. Reading them is part
      // of the round, but its failure is not the loop's: it is noted and the chain goes on.
      if (!stopped && Date.now() - lastInboxAt >= INBOX_EVERY_MS) {
        lastInboxAt = Date.now();
        // this call can take as long as a round: hold the claim on the loop through it
        writeStored(LOCK_KEY, { id: tabId, until: Date.now() + REQUEST_TIMEOUT_MS + LOCK_MARGIN_MS });
        try {
          const inbox = await api.outreachInbox(REQUEST_TIMEOUT_MS);
          entry = { ...entry, reason: `${entry.reason} · Mailbox: ${inbox.reason || inbox.error || 'no answer'}` };
        } catch {
          entry = { ...entry, reason: `${entry.reason} · Mailbox: could not be read this time` };
        }
      }
      if (stopped) return;

      logRef.current = appendLog(logRef.current, entry);
      writeStored(LOG_KEY, logRef.current);
      setLog(logRef.current);
      setFailures(failed);
      setStarted(true);
      writeStored(LOCK_KEY, { id: tabId, until: Date.now() + delay + LOCK_MARGIN_MS });
      schedule(delay);
    }

    // Let go of the loop when the tab closes or reloads, so the next tab starts at once.
    const release = () => {
      if (readStored<RunnerLock | null>(LOCK_KEY, null)?.id === tabId) writeStored(LOCK_KEY, null);
    };
    window.addEventListener('pagehide', release);
    // Through the timer, so the effect's double run in development cancels the first start.
    schedule(0);

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  const last = log.length ? log[log.length - 1] : null;
  const sentToday = last ? last.sentToday : 0;
  const gap = longestGapMs(log);

  // The count in the tab title, so it can be read from the taskbar.
  useEffect(() => {
    const state = blocked ? 'paused' : failures ? `error, ${sentToday} sent today` : `${sentToday} sent today`;
    document.title = `${state} · GridLeads runner`;
  }, [blocked, failures, sentToday]);

  const clearLog = () => {
    logRef.current = [];
    writeStored(LOG_KEY, null);
    setLog([]);
  };

  const status = !started ? { cls: 'gray', text: 'Starting' }
    : blocked ? { cls: 'amber', text: 'Paused' }
    : failures ? { cls: 'red', text: 'Error' }
    : { cls: 'green', text: 'Running' };
  const loggedOut = !!last && !last.ok && last.reason.startsWith('unauthorized');

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 14px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong>Outreach runner</strong>
            <span className={`chip ${status.cls}`}>{status.text}</span>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Keep this tab open. It asks the server every 30 to 60 seconds; the server decides what is sent.</span>
        </div>

        {blocked && (
          <div className="log-tile">Another tab is already running the loop, so this one is not calling the server. It takes over by itself when the other tab is closed.</div>
        )}
        {!blocked && failures > 0 && last && (
          <div className="log-tile">
            <span className="chip red">Last error</span> {last.reason}. {failures} failed {failures === 1 ? 'round' : 'rounds'} in a row; trying again at {nextAt ? clock(nextAt) : 'the next round'}.
            {loggedOut && <> <a href="/login?next=/outreach/runner">Sign in again</a></>}
          </div>
        )}

        <div className="log-tiles">
          <div className="log-tile"><div className="log-tile-n">{sentToday}</div>Sent today</div>
          <div className="log-tile"><div className="log-tile-n">{last ? clock(last.at) : '—'}</div>Last round</div>
          <div className="log-tile"><div className="log-tile-n">{nextAt ? clock(nextAt) : '—'}</div>Next round</div>
          <div className="log-tile"><div className={`log-tile-n${gap > GAP_LIMIT_MS ? ' red' : ''}`}>{log.length > 1 ? `${Math.round(gap / 60_000)} min` : '—'}</div>Longest pause in the log</div>
        </div>

        {last && last.ok && (
          <div className="log-tile">
            <span className={`chip ${last.action === 'sent' ? 'green' : last.action === 'blocked' ? 'amber' : 'gray'}`}>{last.action === 'sent' ? 'Sent' : last.action === 'blocked' ? 'Sending blocked' : 'Skipped'}</span> {last.reason || 'No reason given'}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>{log.length > SHOWN_ROWS ? `Last ${SHOWN_ROWS} of ${log.length} rounds stored in this browser` : `${log.length} ${log.length === 1 ? 'round' : 'rounds'} stored in this browser`}</span>
          <button className="btn" onClick={clearLog} disabled={!log.length}>Clear log</button>
        </div>

        {!started && <div className="empty">Starting the loop…</div>}
        {started && !log.length && <div className="empty">No rounds yet.</div>}
        {log.slice(-SHOWN_ROWS).reverse().map((e) => (
          <div key={e.at} className="log-tile" style={{ display: 'grid', gridTemplateColumns: '150px 64px 1fr 64px', gap: 10, alignItems: 'baseline' }}>
            <span className="muted">{new Date(e.at).toLocaleString()}</span>
            <span className={`chip ${e.ok ? (e.action === 'sent' ? 'green' : e.action === 'blocked' ? 'amber' : 'gray') : 'red'}`}>{e.ok ? (e.action === 'sent' ? 'Sent' : e.action === 'blocked' ? 'Blocked' : 'Skipped') : 'Error'}</span>
            <span>{e.reason}</span>
            <span className="muted" style={{ textAlign: 'right' }}>{e.ms} ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
