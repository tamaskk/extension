import { dbConnect } from '@/lib/db';
import { OutreachSequence, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { stopSequenceLeads } from '@/lib/outreachState';
import { cleanSequence, validateSequence } from '@/lib/outreachSequence.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/outreach/sequences/[id]  { ...fields }
// Only the fields that are sent change. The result is checked as a whole: a
// sequence that is switched on, or is being switched on, must pass every check.
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const sequenceId = String((await ctx.params).id || '');
    const current = await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as Record<string, unknown> | null;
    if (!current) return json({ ok: false, error: 'The sequence was not found.' }, { status: 404 });

    const value = cleanSequence(await req.json().catch(() => ({})), false);
    if (value.name === '') return json({ ok: false, error: 'The sequence has no name.' }, { status: 400 });
    const merged = { ...current, ...value };
    const errors = validateSequence(merged);
    if (merged.enabled && errors.length) return json({ ok: false, error: 'A sequence that is switched on must be complete. ' + errors.join(' '), errors }, { status: 400 });
    if (!Object.keys(value).length) return json({ ok: true, errors });

    await OutreachSequence.updateOne({ sequenceId }, { $set: { ...value, updatedAt: new Date().toISOString() } });
    const what = value.enabled === true && !current.enabled ? 'switched on' : value.enabled === false && current.enabled ? 'switched off' : 'edited';
    await logActivity({ type: 'outreach.sequence', n: 1, title: `Sequence ${what}: ${merged.name}`, data: { sequenceId, changed: Object.keys(value) } });
    return json({ ok: true, errors });
  } catch (e) {
    console.error('outreach sequence update failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The sequence could not be saved.' }, { status: 500 });
  }
}

// DELETE /api/outreach/sequences/[id]
// The leads come first: every lead still active in the sequence is stopped, so
// none is left pointing at a sequence that is gone. Only then is the sequence
// removed. If the first part fails, the sequence is still there to try again.
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const sequenceId = String((await ctx.params).id || '');
    const current = await OutreachSequence.findOne({ sequenceId }).select('name -_id').lean() as { name?: string } | null;
    if (!current) return json({ ok: false, error: 'The sequence was not found.' }, { status: 404 });

    const stopped = await stopSequenceLeads(sequenceId, current.name || '', 'sequence_deleted');
    await OutreachSequence.deleteOne({ sequenceId });
    await logActivity({ type: 'outreach.sequence', n: 1, title: `Sequence deleted: ${current.name || sequenceId}`, data: { sequenceId, stoppedLeads: stopped } });
    return json({ ok: true, stopped });
  } catch (e) {
    console.error('outreach sequence delete failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The sequence could not be deleted. Nothing was removed.' }, { status: 500 });
  }
}
