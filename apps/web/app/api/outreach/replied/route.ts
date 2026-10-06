import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';
import { stopSequence } from '@/lib/outreachState';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/replied  { project, dedupKey }
// The operator says this lead answered, by hand. The fallback for what the
// mailbox watcher cannot see: a phone call back, a brand-new email, an answer
// from a secretary's address. The sequence stops; no further step goes out.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const project = String(b?.project || ''), dedupKey = String(b?.dedupKey || '');
    const lead = await Lead.findOne({ project, dedupKey }).select('project dedupKey name seq.status seq.sequenceId -_id').lean() as { project: string; dedupKey: string; name?: string; seq?: { status?: string; sequenceId?: string } } | null;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
    // running, or waiting for its follow-ups: both can still get an email
    if (lead.seq?.status !== 'active' && lead.seq?.status !== 'waiting') return json({ ok: false, error: 'This lead is not in a sequence.' }, { status: 400 });
    const stopped = await stopSequence(lead, 'replied');
    if (stopped) await Lead.updateOne({ project, dedupKey }, { $set: { 'seq.repliedAt': new Date().toISOString() } });
    return json({ ok: true, stopped, status: 'replied' });
  } catch (e) {
    console.error('manual replied failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'That could not be saved.' }, { status: 500 });
  }
}
