import { dbConnect } from '@/lib/db';
import { OutreachSender, OutreachSequence, CORS, json } from '@/lib/models';
import { reportGroups } from '@/lib/outreachSends';
import { readSettings } from '@/lib/outreachSettings';
import { MIN_SAMPLE, THRESHOLDS, buildReport, postmasterAge } from '@/lib/outreachReport.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/report?days=7|30|0
// What went out and what became of it, as far as SMTP lets it be known:
// totals and the breakdowns by step, sender and offer, with rates and warning
// levels. `days=0` is all time. Every number is counted from `outreachsends`,
// never from `leads`, and already folded here: the client gets a few dozen
// rows, not thousands. Seed emails are left out of the rates and counted apart.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const asked = Number(new URL(req.url).searchParams.get('days'));
    const days = [7, 30, 0].includes(asked) ? asked : 7;
    const [{ groups, seeds }, sequences, senders, settings] = await Promise.all([
      reportGroups(days),
      OutreachSequence.find().select('sequenceId name steps.id steps.variantOf -_id').sort({ createdAt: 1 }).lean(),
      OutreachSender.find().select('senderId label fromEmail -_id').lean() as unknown as Promise<{ senderId: string; label?: string; fromEmail: string }[]>,
      readSettings(),
    ]);
    const report = buildReport(groups, { sequences, senders: senders.map((s) => ({ senderId: s.senderId, label: s.label || s.fromEmail })) });
    return json({ ok: true, days, ...report, seeds, thresholds: THRESHOLDS, minSample: MIN_SAMPLE, postmaster: { ...settings.postmaster, ...postmasterAge(settings.postmaster.date) } });
  } catch (e) {
    console.error('outreach report failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The report could not be built.' }, { status: 500 });
  }
}
