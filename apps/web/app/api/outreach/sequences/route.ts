import { randomBytes } from 'node:crypto';
import { dbConnect } from '@/lib/db';
import { OutreachSequence, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { activeLeadCounts } from '@/lib/outreachState';
import { sentByStep, sentLast7BySequence } from '@/lib/outreachSends';
import { cleanSequence, validateSequence } from '@/lib/outreachSequence.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/sequences
// Every sequence with its steps, what is wrong with it (`errors`, empty when it
// may run), how many leads are in it right now and what it sent in seven days.
export async function GET() {
  try {
    await dbConnect();
    const docs = await OutreachSequence.find().select('-_id').sort({ createdAt: 1 }).lean() as unknown as Record<string, unknown>[];
    // Until the `gl_seq_due` index exists the count cannot be read without a
    // scan of every lead; the list is still worth showing then.
    let counts = new Map<string, number>(), capped = false, countsKnown = true;
    try {
      ({ counts, capped } = await activeLeadCounts());
    } catch (e) {
      countsKnown = false;
      console.error('active lead counts unavailable', e instanceof Error ? e.message : '');
    }
    const [sent, perStep] = await Promise.all([sentLast7BySequence(), sentByStep()]);
    const sequences = docs.map((d) => ({ ...d, errors: validateSequence(d), activeLeads: countsKnown ? counts.get(String(d.sequenceId)) || 0 : null, sentLast7: sent.get(String(d.sequenceId)) || 0, sentByStep: perStep.get(String(d.sequenceId)) || {} }));
    return json({ ok: true, sequences, activeCapped: capped });
  } catch (e) {
    console.error('outreach sequences list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The sequences could not be loaded.' }, { status: 500 });
  }
}

// POST /api/outreach/sequences  { name, language, senderIds, steps, stopOnReply, stopOnBounce, enabled }
// A new sequence. It may be saved unfinished, as long as it is switched off;
// switched on, it must pass every check.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const value = cleanSequence(await req.json().catch(() => ({})), true);
    if (!value.name) return json({ ok: false, error: 'The sequence has no name.' }, { status: 400 });
    const errors = validateSequence(value);
    if (value.enabled && errors.length) return json({ ok: false, error: 'This sequence cannot be switched on yet. ' + errors.join(' '), errors }, { status: 400 });

    const now = new Date().toISOString();
    const sequenceId = randomBytes(6).toString('hex');
    await OutreachSequence.create({ ...value, sequenceId, createdAt: now, updatedAt: now });
    await logActivity({ type: 'outreach.sequence', n: 1, title: `Sequence created: ${value.name}`, data: { sequenceId, steps: value.steps?.length || 0, enabled: value.enabled } });
    return json({ ok: true, sequenceId, errors });
  } catch (e) {
    console.error('outreach sequence create failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The sequence could not be saved.' }, { status: 500 });
  }
}
