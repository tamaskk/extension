import { CORS, json } from '@/lib/models';
import { readHeartbeat, runRound } from '@/lib/dispatcher';
import { refuseUnlessOperator } from '@/lib/session';
import { DEFAULT_DELAY_MS } from '@/lib/outreachRunner.mjs';

export const runtime = 'nodejs';
// A round sends three emails at most and is done in seconds; the limit is only a ceiling.
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/tick  { ignoreWindow?, testMode? }
// One round of the outreach loop, called by the runner tab
// (components/OutreachRunner.tsx) every 30 to 60 seconds. The tab only
// schedules; whether anything is sent, and what, is decided in lib/dispatcher.ts
// on every call. It sends real email.
//   → { ok, sent, skipped, remaining, nextAt, nextInMs, reason, action, sentToday }
//   409 with `blocked` and `blockers` when nothing may be sent at all.
// `reason` is a sentence for the tab. `ignoreWindow` sends whatever the hour is
// where the lead lives; `testMode` does the same and stops after three emails.
// Both work on a local machine only.
// Never an unhandled error: the tab can do nothing with one but wait.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    // The two test switches drop the send window and the pause between emails.
    // They are for the operator's own tests on a local machine; a deployed
    // function ignores them, so no request can use them to empty a sender's day at night.
    const local = process.env.NODE_ENV !== 'production';
    const result = await runRound({ ignoreWindow: local && b?.ignoreWindow === true, testMode: local && b?.testMode === true });
    return json(result, result.blocked ? { status: 409 } : undefined);
  } catch (e) {
    // the message of a database or mail error can carry a host or a login name: it stays in the server log
    console.error('outreach round failed', e instanceof Error ? e.message.slice(0, 300) : '');
    return json({ ok: false, error: 'The round could not run. If this repeats, check that the gl_seq_due index exists and the database is reachable.', sent: 0, nextInMs: DEFAULT_DELAY_MS }, { status: 500 });
  }
}

// GET /api/outreach/tick
// The heartbeat, for the watchdog: when the loop last ran and whether that is too long ago.
export async function GET() {
  try {
    return json({ ok: true, ...(await readHeartbeat()) });
  } catch (e) {
    console.error('outreach heartbeat read failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'heartbeat read failed' }, { status: 500 });
  }
}
