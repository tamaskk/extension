import { CORS, json } from '@/lib/models';
import { coerceSource } from '@/lib/enroll';
import { APPLY_CHUNK, applySchedule, planSchedule } from '@/lib/schedule';
import { parseDay } from '@/lib/schedulePlan.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// language → sequenceId, for the two languages leads are written in
function sequencesOf(v: unknown): Record<string, string> {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const language of ['hu', 'en']) {
    const id = typeof o[language] === 'string' ? (o[language] as string).slice(0, 80) : '';
    if (id) out[language] = id;
  }
  return out;
}

// POST /api/outreach/schedule
// Puts the leads of a selection into their sequences on future days, every
// sender's days filled up to its limit of that day. Always two steps.
//   { action: 'plan', source, sequences: { hu?, en? }, mode: 'range' | 'all', from?, to? }
//     writes nothing. → the plan: `days` (per day and sender: cap, booked, free, placed),
//     `placements` (each lead with its sender, day and due time), `skipped`, `left`, `lastDay`
//   { action: 'apply', sequences, items: [{ project, key, senderId, at }], runId? }
//     writes one chunk of a plan (at most 200 leads); every lead and day is checked again.
//     → { written, dropped, runId }; the client sends the next chunk with the `runId` it got back
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const sequences = sequencesOf(b?.sequences);
    if (!Object.keys(sequences).length) return json({ ok: false, error: 'Choose a sequence for at least one language.' }, { status: 400 });

    // anything but an explicit 'apply' is a plan: a malformed request must never write
    if (b?.action !== 'apply') {
      const source = coerceSource(b?.source);
      if (!source) return json({ ok: false, error: 'Choose which leads to schedule: the current filter, the checked leads, or a group.' }, { status: 400 });
      const mode = b?.mode === 'range' ? 'range' : 'all';
      const answer = await planSchedule({ source, sequences, mode, from: parseDay(b?.from) as string, to: parseDay(b?.to) as string });
      return json(answer, answer.ok ? undefined : { status: 400 });
    }

    const items = (Array.isArray(b?.items) ? b.items : []).slice(0, APPLY_CHUNK).map((i: unknown) => {
      const v = i && typeof i === 'object' ? i as Record<string, unknown> : {};
      return { project: String(v.project || '').slice(0, 300), key: String(v.key || '').slice(0, 200), senderId: String(v.senderId || '').slice(0, 80), at: String(v.at || '').slice(0, 40) };
    }).filter((i: { project: string; key: string; senderId: string; at: string }) => i.project && i.key && i.senderId && Number.isFinite(Date.parse(i.at)));
    if (!items.length) return json({ ok: false, error: 'The plan holds no lead.' }, { status: 400 });
    // a lead named twice would take two places of a day
    const once = [...new Map(items.map((i: { project: string; key: string }) => [`${i.project}\n${i.key}`, i])).values()] as typeof items;
    const answer = await applySchedule({ sequences, items: once, runId: /^[a-f0-9]{12}$/.test(String(b?.runId || '')) ? String(b.runId) : '' });
    return json(answer, answer.ok ? undefined : { status: 400 });
  } catch (e) {
    console.error('outreach schedule failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The schedule failed and stopped. Leads written before this point stay scheduled; make a new plan to see where it stands.' }, { status: 500 });
  }
}
