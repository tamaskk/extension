import { createHash, timingSafeEqual } from 'node:crypto';
import { CORS, json } from '@/lib/models';
import { runRound } from '@/lib/dispatcher';
import { checkInbox } from '@/lib/inboxWatcher';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// A cron service fires on the minute; without a random wait every email would
// leave in the same second of a minute. Kept short: cron-job.org gives up
// waiting for an answer after 30 seconds.
const JITTER_MS = 15_000;

// The secret, compared in constant time. Hashing first makes the two buffers
// the same length, which timingSafeEqual needs.
function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// POST /api/outreach/cron?job=send|inbox     Authorization: Bearer <CRON_SECRET>
// The outreach loop for a scheduler, so nothing depends on an open browser tab.
// It does exactly what the runner tab does: `send` runs one send round
// (POST /api/outreach/tick), `inbox` reads one sender mailbox
// (POST /api/outreach/inbox). The gate, the daily limits, the send window and
// the round lock are all inside those and apply here unchanged; the test
// switches of the tick route do not exist here.
//
// This path is open in middleware.ts, because a scheduler has no session. The
// secret is the only way in: without CRON_SECRET in the environment, or with one
// shorter than 32 characters, the route answers 404 to everyone.
// Always 200 once the secret is right, also when sending is blocked: a
// scheduler switches a job off after repeated error answers.
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET || '';
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (expected.length < 32 || !given || !secretMatches(given, expected)) return json({ ok: false, error: 'not found' }, { status: 404 });
  const job = new URL(req.url).searchParams.get('job') === 'inbox' ? 'inbox' : 'send';
  try {
    if (job === 'inbox') {
      const r = await checkInbox();
      return json({ ok: r.ok, job, messages: r.messages || 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * JITTER_MS)));
    const r = await runRound({ ignoreWindow: false, testMode: false });
    return json({ ok: true, job, sent: r.sent, blocked: !!r.blocked });
  } catch (e) {
    // the message of a database or mail error can carry a host or a login name: it stays in the server log
    console.error(`outreach cron ${job} failed`, e instanceof Error ? e.message.slice(0, 300) : '');
    return json({ ok: false, job, error: 'The job failed. See the server log.' });
  }
}
