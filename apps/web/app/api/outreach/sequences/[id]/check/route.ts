import { dbConnect } from '@/lib/db';
import { OutreachSequence, CORS, json } from '@/lib/models';
import { activeLeadsOfSequence } from '@/lib/outreachState';
import type { ActiveSeqLead } from '@/lib/outreachState';
import { cleanSequence, validateSequence } from '@/lib/outreachSequence.mjs';
import { sequenceImpact } from '@/lib/sequenceImpact.mjs';
import { missingCounts } from '@/lib/outreachRender.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/sequences/[id]/check  { ...the edited fields, as PATCH would get them }
// What saving this edit would do, before it is saved. Writes nothing.
//   impact     one line per change, with how many active leads it touches
//   variables  the {{variables}} the texts use and how many active leads lack each
//   errors     what would keep the edited sequence from running
// The leads counted are the ones active in this sequence right now.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const sequenceId = String((await ctx.params).id || '');
    const current = await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as Record<string, unknown> | null;
    if (!current) return json({ ok: false, error: 'The sequence was not found.' }, { status: 404 });
    const proposed = { ...current, ...cleanSequence(await req.json().catch(() => ({})), false) };

    // Without the `gl_seq_due` index the active leads cannot be read. The check
    // still answers, and says that its numbers are not real.
    let leads: ActiveSeqLead[] = [], capped = false, leadsKnown = true;
    try {
      ({ leads, capped } = await activeLeadsOfSequence(sequenceId));
    } catch (e) {
      leadsKnown = false;
      console.error('active leads of the sequence unavailable', e instanceof Error ? e.message : '');
    }
    const impact = sequenceImpact(current, proposed, leads);
    return json({ ok: true, leadsKnown, capped, activeLeads: impact.activeLeads, impact: impact.items, variables: missingCounts(proposed, leads), errors: validateSequence(proposed) });
  } catch (e) {
    console.error('outreach sequence check failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The check could not run. Nothing was saved.' }, { status: 500 });
  }
}
