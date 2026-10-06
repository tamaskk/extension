import { CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { sendSeedTest } from '@/lib/seedTest';
import { refuseUnlessOperator } from '@/lib/session';
import { limit } from '@/lib/rateLimit.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/seed  { senderId, sequenceId, stepId }
// Send one step of a sequence to the seed addresses, the operator's own test
// mailboxes, to see by hand where it lands: inbox, promotions or spam. It sends
// real email, to the stored seed addresses and nowhere else. It does not ask
// the campaign gate: the gate needs a seed result, and this is how one is made.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    // a handful of test emails, not a way to send in bulk
    if (!limit('seedtest', 4, 60 * 60_000).ok) return json({ ok: false, error: 'Four seed tests were sent in the last hour. Read their results first.' }, { status: 429 });
    const r = await sendSeedTest(String(b?.senderId || ''), String(b?.sequenceId || ''), String(b?.stepId || ''));
    if (r.sent?.length) await logActivity({ type: 'outreach.seed', n: r.sent.length, title: `Seed test sent to ${r.sent.length} test ${r.sent.length === 1 ? 'mailbox' : 'mailboxes'}`, data: { senderId: String(b?.senderId || ''), sequenceId: String(b?.sequenceId || ''), stepId: String(b?.stepId || ''), failed: r.failed?.length || 0 } });
    return json(r, r.ok ? undefined : { status: 400 });
  } catch (e) {
    console.error('seed test failed', e instanceof Error ? e.message.slice(0, 200) : '');
    return json({ ok: false, error: 'The seed test could not run. Check the sender account and OUTREACH_SECRET_KEY.' }, { status: 500 });
  }
}
