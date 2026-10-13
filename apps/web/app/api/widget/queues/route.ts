import { CORS, OutreachSend, OutreachSender, json } from '@/lib/models';
import { dbConnect } from '@/lib/db';
import { todayPlan } from '@/lib/outreachToday';
import { dayKey, dayStart } from '@/lib/warmup.mjs';
import { widgetDay, widgetQueues } from '@/lib/widgetQueues.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The route is open (OPEN_API in middleware.ts), so anyone who knows the address
// can call it. Today's answer costs a dozen queries; it is kept this long per
// instance, so a caller in a loop cannot load the database.
const KEEP_MS = 20_000;
let kept: { at: number; day: string; data: unknown } | null = null;

// GET /api/widget/queues[?date=YYYY-MM-DD]
// The day's sending for the home-screen widget (apps/web/widget/gridleads-queues.js):
// one queue per sender account, with what went out, what failed and what is
// still to go. Read-only. A day is a Budapest day, like the daily limit.
// Open on purpose: a widget has no session. It answers the senders' names and
// counts only, never an address or a lead.
// → { date, timezone, generatedAt, totals: { total, done, failed, pending, inProgress },
//     queues: [{ id, name, type, status, total, done, failed, pending, inProgress, quota, nextRunAt, lastActivityAt, completedAt }] }
export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const now = new Date();
    const today = dayKey(now) as string;
    const asked = new URL(req.url).searchParams.get('date');
    const date = asked === null ? today : widgetDay(asked) as string;
    if (!date) return json({ error: 'date must be YYYY-MM-DD' }, { status: 400, headers });
    if (date === today && kept && kept.day === today && now.getTime() - kept.at < KEEP_MS) return json(kept.data, { headers });

    await dbConnect();
    // the day in Budapest, as two instants: found from the zone, so the two clock changes of the year are right
    const start = dayStart(new Date(date + 'T12:00:00.000Z')) as Date;
    const end = dayStart(new Date(start.getTime() + 36 * 3_600_000)) as Date;
    const [sends, senders, plan] = await Promise.all([
      OutreachSend.aggregate([
        { $match: { sentAt: { $gte: start.toISOString(), $lt: end.toISOString() } } },
        { $group: { _id: { senderId: '$senderId', outcome: '$outcome' }, n: { $sum: 1 }, last: { $max: '$sentAt' } } },
      ]) as Promise<{ _id: { senderId: string; outcome: string }; n: number; last: string }[]>,
      OutreachSender.find().select('senderId label -_id').lean() as unknown as Promise<{ senderId: string; label?: string }[]>,
      date === today ? todayPlan(now) : null,
    ]);
    const data = widgetQueues({
      date, now, plan,
      sends: sends.map((s) => ({ senderId: s._id.senderId, outcome: s._id.outcome, n: s.n, last: s.last })),
      // a sender without a label is named by its id, never by its address
      labels: new Map(senders.map((s) => [s.senderId, s.label || s.senderId])),
    });
    if (date === today) kept = { at: now.getTime(), day: today, data };
    return json(data, { headers });
  } catch (e) {
    console.error('widget queues failed', e instanceof Error ? e.message : '');
    return json({ error: 'The queues could not be read.' }, { status: 500, headers });
  }
}
