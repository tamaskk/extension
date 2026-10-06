import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/offer  { project, dedupKey, offer: 'ai' | 'social' }
// The operator chooses the second-round offer of a lead by hand. It is marked
// as chosen by hand (`seq.offerManual`), and nothing computes it again after that.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const project = String(b?.project || ''), dedupKey = String(b?.dedupKey || '');
    const offer = b?.offer === 'ai' ? 'ai' : b?.offer === 'social' ? 'social' : '';
    if (!offer) return json({ ok: false, error: 'The offer must be ai or social.' }, { status: 400 });
    const lead = await Lead.findOne({ project, dedupKey }).select('name seq.offer seq.sequenceId -_id').lean() as { name?: string; seq?: { offer?: string; sequenceId?: string } } | null;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
    if (!lead.seq?.sequenceId) return json({ ok: false, error: 'This lead is not in a sequence, so it has no offer to change.' }, { status: 400 });
    await Lead.updateOne({ project, dedupKey }, { $set: { 'seq.offer': offer, 'seq.offerManual': true } });
    await logActivity({ type: 'outreach.offer', project, keys: [dedupKey], n: 1, title: `${lead.name || dedupKey}: second-round offer set by hand to ${offer === 'ai' ? 'AI automation' : 'social media'}`, data: { name: lead.name, from: lead.seq.offer || '', to: offer } });
    return json({ ok: true, offer });
  } catch (e) {
    console.error('outreach offer override failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'That could not be saved.' }, { status: 500 });
  }
}
