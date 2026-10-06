import { CORS, json } from '@/lib/models';
import { todayPlan } from '@/lib/outreachToday';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/today
// The Campaign tab: whether sending is allowed, each sender's limit, the leads
// in line for today with what will become of each (`fate`), and what went out
// today.  → { ok, gate, heartbeat, senders, sequences, queue, sent, at }
// Read-only: it shows what the next send rounds will find, it starts nothing.
export async function GET() {
  try {
    return json({ ok: true, ...(await todayPlan()) });
  } catch (e) {
    console.error('outreach today plan failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The plan of the day could not be loaded. If this repeats, check that the gl_seq_due index exists.' }, { status: 500 });
  }
}
