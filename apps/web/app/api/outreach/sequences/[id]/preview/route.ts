import { dbConnect } from '@/lib/db';
import { Lead, OutreachSequence, CORS, json } from '@/lib/models';
import { absoluteDayOf, cleanSequence, enabledSteps } from '@/lib/outreachSequence.mjs';
import { VARIABLE_FIELDS, isKnownVariable, render, renderContext } from '@/lib/outreachRender.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

interface Step { id: string; subject?: string; body?: string; sameThread?: boolean }
type LeadDoc = Record<string, unknown> & { project?: string; dedupKey?: string };

const FIELDS = ['project', 'dedupKey', 'email', ...VARIABLE_FIELDS, '-_id'].join(' ');

// A real lead to show the emails with, when the caller names none: one that is
// in this sequence now, or, while the sequence is empty, one of the leads with
// an email address (read in opportunity order through `gl_email_opp`). `skip`
// moves on to another one.
async function sampleLead(sequenceId: string, skip: number): Promise<LeadDoc | null> {
  try {
    const active = await Lead.find({ 'seq.status': 'active', 'seq.sequenceId': sequenceId }).hint('gl_seq_due').select(FIELDS).skip(skip).limit(1).lean() as unknown as LeadDoc[];
    if (active.length) return active[0];
  } catch (e) {
    // no `gl_seq_due` index yet: nobody can be in the sequence either
    console.error('preview: active leads unavailable', e instanceof Error ? e.message : '');
  }
  const any = await Lead.find({ email: { $gt: '' } }).sort({ opportunityScore: -1, _id: 1 }).select(FIELDS).skip(skip % 500).limit(1).lean() as unknown as LeadDoc[];
  return any[0] || null;
}

// POST /api/outreach/sequences/[id]/preview  { project?, dedupKey?, skip?, steps? }
// The emails of a sequence as one real lead would get them: the steps that are
// switched on, in order, each on its day, with the lead's values filled in.
// Sends nothing and writes nothing. With `steps` it shows the edit that is not
// saved yet. `missing` and `unknown` on a step name the variables that left a
// hole for this lead; such a text would not be sent.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const sequenceId = String((await ctx.params).id || '');
    const b = await req.json().catch(() => ({}));
    const stored = await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as { steps?: Step[] } | null;
    if (!stored) return json({ ok: false, error: 'The sequence was not found.' }, { status: 404 });
    const sequence = Array.isArray(b?.steps) ? { ...stored, ...cleanSequence({ steps: b.steps }, false) } : stored;

    const skip = Math.max(0, Math.floor(Number(b?.skip) || 0));
    const lead = b?.dedupKey
      ? await Lead.findOne({ project: String(b?.project || ''), dedupKey: String(b.dedupKey) }).select(FIELDS).lean() as unknown as LeadDoc | null
      : await sampleLead(sequenceId, skip);
    if (!lead) return json({ ok: false, error: 'No lead to preview with.' }, { status: 404 });

    // the same renderer as the send; `mark` leaves a gap visible as [name]
    const values = renderContext(lead);
    const steps = (enabledSteps(sequence) as Step[]).map((s) => {
      const subject = render(s.subject || '', values, true);
      const body = render(s.body || '', values, true);
      const gaps = [...new Set([...subject.missing, ...body.missing])];
      return {
        id: s.id, day: absoluteDayOf(sequence, s.id), sameThread: !!s.sameThread,
        subject: subject.out, body: body.out,
        missing: gaps.filter((v) => isKnownVariable(v)),
        unknown: gaps.filter((v) => !isKnownVariable(v)),
      };
    });
    const show = (k: string) => (lead[k] === undefined || lead[k] === null ? '' : String(lead[k]));
    return json({
      ok: true, rendered: true,
      lead: { project: show('project'), dedupKey: show('dedupKey'), name: show('name'), email: show('email'), category: show('category'), address: show('address'), website: show('website') },
      steps,
    });
  } catch (e) {
    console.error('outreach sequence preview failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The preview could not be built.' }, { status: 500 });
  }
}
