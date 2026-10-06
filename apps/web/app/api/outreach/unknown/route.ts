import { dbConnect } from '@/lib/db';
import { Lead, OutreachSequence, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { listUnknownSends, settleUnknownSend } from '@/lib/outreachSends';
import { advanceSequence, retryHeldLead, stopHeldLead } from '@/lib/outreachState';
import { refuseUnlessOperator } from '@/lib/session';
import { resolveUnknown } from '@/lib/sendGuard.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/unknown
// The emails of unknown fate: a round died around the send, so the email may
// have gone out and may not. A machine never sends such an email again; each
// one waits here for the operator.
export async function GET() {
  try {
    await dbConnect();
    const sends = await listUnknownSends();
    const leads = sends.length ? await Lead.find({ dedupKey: { $in: sends.map((s) => s.dedupKey) } }).select('dedupKey name -_id').lean() as { dedupKey: string; name?: string }[] : [];
    const nameOf = new Map(leads.map((l) => [l.dedupKey, l.name || '']));
    return json({ ok: true, sends: sends.map((s) => ({ ...s, name: nameOf.get(s.dedupKey) || '' })) });
  } catch (e) {
    console.error('unknown sends list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The list could not be loaded.' }, { status: 500 });
  }
}

// POST /api/outreach/unknown  { id, decision: 'sent' | 'resend' }
//   sent    the email is taken as sent: the lead moves on to its next step
//   resend  the email is taken as not sent: the step is due again, now
export async function POST(req: Request) {
  try {
    // "send it again" leads to a real email: the same guard as the send round
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const decision = resolveUnknown(String(b?.decision || '')) as { outcome: 'sent' | 'failed'; lead: 'advance' | 'retry' } | null;
    if (!decision) return json({ ok: false, error: 'Choose "it was sent" or "send it again".' }, { status: 400 });
    const row = await settleUnknownSend(String(b?.id || ''), decision.outcome);
    if (!row) return json({ ok: false, error: 'This email is not waiting for a decision any more.' }, { status: 404 });

    const lead = await Lead.findOne({ project: row.project, dedupKey: row.dedupKey }).select('project dedupKey name seq.stepId seq.sequenceId -_id').lean() as { project: string; dedupKey: string; name?: string; seq?: { stepId?: string; sequenceId?: string } } | null;
    let moved = false;
    if (lead && decision.lead === 'retry') moved = await retryHeldLead(lead.project, lead.dedupKey);
    if (lead && decision.lead === 'advance') {
      const sequence = await OutreachSequence.findOne({ sequenceId: row.sequenceId }).select('-_id').lean() as unknown as { sequenceId: string; name?: string } | null;
      // without its sequence the lead has no next step to move to: it ends here instead of staying on hold for good
      moved = sequence
        ? await advanceSequence(lead, sequence, row.stepId, row.messageId, new Date(), 'hold', { emailSentAt: row.sentAt, emailSentTo: row.to })
        : await stopHeldLead(lead.project, lead.dedupKey);
    }
    await logActivity({
      type: 'outreach.unknown', project: row.project, keys: [row.dedupKey], n: 1,
      title: `${lead?.name || row.dedupKey}: an email of unknown fate to ${row.to} was settled as ${decision.outcome === 'sent' ? 'sent' : 'not sent, to be sent again'}`,
      data: { sendId: row.id, decision: b?.decision, sequenceId: row.sequenceId, stepId: row.stepId },
    });
    return json({ ok: true, moved });
  } catch (e) {
    console.error('unknown send decision failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The decision could not be saved.' }, { status: 500 });
  }
}
