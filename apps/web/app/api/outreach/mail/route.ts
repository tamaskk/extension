import { dbConnect } from '@/lib/db';
import { OutreachInbox, OutreachSend, OutreachSender, OutreachSequence, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const LIMIT = 300; // of each direction; the page shows the newest of both together

interface SendDoc { project?: string; dedupKey?: string; sequenceId?: string; stepId?: string; senderId?: string; to?: string; sentAt?: string; outcome?: string; isSeed?: boolean; bounceDiagnostic?: string }
interface InboxDoc { senderId?: string; kind?: string; from?: string; subject?: string; at?: string; snippet?: string; stop?: boolean; leadName?: string; project?: string; dedupKey?: string; ignored?: string }
interface SequenceDoc { sequenceId: string; name?: string; steps?: { id: string; variantOf?: string }[] }

// GET /api/outreach/mail[?sender=<senderId>]
// Everything that went out and came in, over every sender account or one,
// newest first: the emails GridLeads sent (`outreachsends`) and the messages
// the mailbox watcher read (`outreachinbox`).
//   → { ok, senders: [{ senderId, label, fromEmail }], rows: [{ dir, at, senderId, address, title, state, ... }], capped }
// Not here: emails written by hand in Gmail, and anything that arrived before
// the account was added. The text of a sent email is not stored; `sequenceId`
// and the lead let the page show it through the preview.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const sender = new URL(req.url).searchParams.get('sender') || '';
    const bySender = sender ? { senderId: sender } : {};
    const [senders, sequences, sends, inbox] = await Promise.all([
      OutreachSender.find().select('senderId label fromEmail -_id').sort({ createdAt: 1 }).lean() as unknown as Promise<{ senderId: string; label?: string; fromEmail: string }[]>,
      OutreachSequence.find().select('sequenceId name steps.id steps.variantOf -_id').lean() as unknown as Promise<SequenceDoc[]>,
      OutreachSend.find(bySender).sort({ sentAt: -1 }).limit(LIMIT + 1)
        .select('project dedupKey sequenceId stepId senderId to sentAt outcome isSeed bounceDiagnostic -_id').lean() as unknown as Promise<SendDoc[]>,
      OutreachInbox.find(bySender).sort({ at: -1 }).limit(LIMIT + 1)
        .select('senderId kind from subject at snippet stop leadName project dedupKey ignored -_id').lean() as unknown as Promise<InboxDoc[]>,
    ]);
    const capped = sends.length > LIMIT || inbox.length > LIMIT;
    const sequenceOf = new Map(sequences.map((s) => [s.sequenceId, s]));
    // "step 2": a wording variant counts as the step it is a variant of
    const stepOf = (s: SequenceDoc | undefined, stepId: string) => {
      const all = s?.steps || [];
      const hit = all.find((x) => x.id === stepId);
      return all.filter((x) => !x.variantOf).findIndex((x) => x.id === (hit?.variantOf || stepId)) + 1;
    };
    const rows = [
      ...sends.slice(0, LIMIT).map((r) => {
        const s = sequenceOf.get(r.sequenceId || '');
        const step = stepOf(s, r.stepId || '');
        return {
          dir: 'out' as const, at: r.sentAt || '', senderId: r.senderId || '', address: r.to || '',
          title: r.isSeed ? 'Seed test' : !r.sequenceId ? 'Sent by hand from a lead' : `${s?.name || 'A deleted sequence'}${step > 0 ? ` · step ${step}` : ''}`,
          state: r.outcome || 'sent', note: r.bounceDiagnostic || '',
          // enough to open the preview of what this lead got
          sequenceId: s && !r.isSeed ? s.sequenceId : '', project: r.isSeed ? '' : r.project || '', dedupKey: r.isSeed ? '' : r.dedupKey || '',
        };
      }),
      ...inbox.slice(0, LIMIT).map((r) => ({
        dir: 'in' as const, at: r.at || '', senderId: r.senderId || '', address: r.from || '',
        title: r.subject || 'No subject', state: r.stop ? 'stop' : r.kind || '', note: r.snippet || '',
        leadName: r.leadName || '', ignored: r.ignored || '',
        sequenceId: '', project: r.project || '', dedupKey: r.dedupKey || '',
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return json({ ok: true, senders: senders.map((s) => ({ senderId: s.senderId, label: s.label || s.fromEmail, fromEmail: s.fromEmail })), rows, capped });
  } catch (e) {
    console.error('outreach mail log failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The mail log could not be loaded.' }, { status: 500 });
  }
}
