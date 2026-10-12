// The day's sending as a home-screen widget reads it (GET /api/widget/queues):
// one "queue" per sender account, with what went out, what failed and what is
// still to go today. Pure: the plan of the day (lib/outreachToday.ts) and the
// day's send counts are handed in.
//
// The shape is fixed by the widget script (apps/web/widget/gridleads-queues.js),
// which is shared with another app's widget: do not rename or drop a field.
import { WARMUP_TIME_ZONE } from './warmup.mjs';

const ORDER = { error: 0, running: 1, paused: 2, idle: 3, done: 4 };

// A 'YYYY-MM-DD' that is a real calendar day, or ''.
export function widgetDay(value) {
  const v = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const t = Date.parse(v + 'T12:00:00.000Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : '';
}

//   date      the Budapest day asked for
//   now       when the answer is made
//   sends     [{ senderId, outcome, n, last }]: the day's emails per sender and outcome, `last` the newest sentAt
//   labels    Map(senderId → name)
//   plan      today only, else null: { senders: [{ senderId, label, capToday }], queue: [{ senderId, fate, expectedAt }], gate: { allowed }, heartbeat: { stale } }
// An email that left counts as done whatever became of it later (a bounce is
// an outcome of a sent email); `failed` is an email no mail server took.
// `pending` is what the plan of the day still expects to go out today: a lead
// that waits for tomorrow's limit or for a sending day is not part of today.
export function widgetQueues({ date, now, sends, labels, plan }) {
  const bySender = new Map();
  const row = (id) => {
    if (!bySender.has(id)) bySender.set(id, { done: 0, failed: 0, inProgress: 0, pending: 0, goingNow: 0, last: '', next: '' });
    return bySender.get(id);
  };
  for (const s of sends || []) {
    const r = row(s.senderId);
    if (s.outcome === 'failed') r.failed += s.n;
    else if (s.outcome === 'sending') r.inProgress += s.n;
    else r.done += s.n;
    if (s.last && s.last > r.last) r.last = s.last;
  }
  for (const q of (plan && plan.queue) || []) {
    if (q.fate !== 'today' && q.fate !== 'hours') continue;
    const r = row(q.senderId);
    r.pending++;
    if (q.fate === 'today') r.goingNow++;
    if (q.expectedAt && (!r.next || q.expectedAt < r.next)) r.next = q.expectedAt;
  }
  const capOf = new Map(((plan && plan.senders) || []).map((s) => [s.senderId, s]));

  const queues = [];
  for (const [senderId, r] of bySender) {
    const total = r.done + r.failed + r.pending + r.inProgress;
    if (!total) continue;
    let status = 'idle';
    if (r.pending + r.inProgress === 0) status = 'done';
    else if (r.inProgress > 0) status = 'running';
    // the campaign gate stopped sending: nothing goes out until the operator acts
    else if (plan && !plan.gate.allowed) status = 'error';
    // the send loop is silent, or it is not a sending hour yet where the leads are
    else if (plan && (plan.heartbeat.stale || !r.goingNow)) status = 'paused';
    else status = 'running';
    const sender = capOf.get(senderId);
    queues.push({
      id: `smtp:${senderId}`,
      // from `labels`, not from the plan: the plan names a sender without a label by its address
      name: (labels && labels.get(senderId)) || senderId,
      type: 'smtp',
      status, total, done: r.done, failed: r.failed, pending: r.pending, inProgress: r.inProgress,
      // the limit of a past day is not kept anywhere, so only today has one
      quota: sender ? { used: r.done + r.inProgress, limit: sender.capToday } : null,
      nextRunAt: status === 'running' || status === 'paused' ? r.next || null : null,
      lastActivityAt: r.last || null,
      completedAt: status === 'done' ? r.last || null : null,
    });
  }
  queues.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  const sum = (k) => queues.reduce((n, q) => n + q[k], 0);
  return {
    date, timezone: WARMUP_TIME_ZONE, generatedAt: now.toISOString(),
    totals: { total: sum('total'), done: sum('done'), failed: sum('failed'), pending: sum('pending'), inProgress: sum('inProgress') },
    queues,
  };
}
