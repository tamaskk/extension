import { CORS, json } from '@/lib/models';
import { MAX_KEYS, MAX_LIMIT, runContinue, runEnrollment, runUnenrollment } from '@/lib/enroll';
import type { EnrollRequest, EnrollSource } from '@/lib/enroll';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The selection, coerced: one of the existing ways to pick leads, or a list of lead keys.
function sourceOf(s: unknown): EnrollSource | null {
  const v = s && typeof s === 'object' ? s as Record<string, unknown> : {};
  if (v.kind === 'checked') return { kind: 'checked' };
  if (v.kind === 'group' && typeof v.groupId === 'string' && v.groupId) return { kind: 'group', groupId: v.groupId };
  if (v.kind === 'keys' && Array.isArray(v.keys)) {
    const keys = [...new Set(v.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200))];
    return keys.length && keys.length <= MAX_KEYS ? { kind: 'keys', keys } : null;
  }
  if (v.kind === 'filter' && typeof v.query === 'string') return { kind: 'filter', query: v.query.slice(0, 20_000) };
  return null;
}

// POST /api/outreach/enroll
//   { action: 'enroll' | 'unenroll' | 'continue', dryRun, sequenceId, source, limit, ignoreLanguage?, cursor?, runId?, taken? }
// `continue` starts the follow-ups of the leads that got the opening email and wait.
// Always two steps. `dryRun: true` writes nothing and answers what would
// happen: how many leads the selection holds, how many would go in, who is left
// out and why, the split between languages and senders, and ten sample rows.
// `dryRun: false` does it, one chunk of 500 candidates per call: the answer
// carries `done`, and until it is true the client calls again with the
// `cursor`, `runId` and `taken` it got back.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const source = sourceOf(b?.source);
    if (!source) return json({ ok: false, error: 'Choose what to enrol: the current filter, the checked leads, or a group.' }, { status: 400 });
    const action = b?.action === 'unenroll' ? 'unenroll' : b?.action === 'continue' ? 'continue' : 'enroll';
    const sequenceId = String(b?.sequenceId || '');
    if (action === 'enroll' && !sequenceId) return json({ ok: false, error: 'Choose a sequence.' }, { status: 400 });
    const cursor = String(b?.cursor || '');
    if (cursor && !/^[a-f0-9]{24}$/.test(cursor)) return json({ ok: false, error: 'The run cannot be continued from here. Start it again with a preview.' }, { status: 400 });

    const request: EnrollRequest = {
      action, sequenceId, source,
      // anything but an explicit false is a preview: a malformed request must never write
      dryRun: b?.dryRun !== false,
      limit: Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(b?.limit) || 500))),
      ignoreLanguage: b?.ignoreLanguage === true,
      cursor,
      runId: /^[a-f0-9]{12}$/.test(String(b?.runId || '')) ? String(b.runId) : '',
      taken: Math.max(0, Math.floor(Number(b?.taken) || 0)),
    };
    const answer = action === 'unenroll' ? await runUnenrollment(request) : action === 'continue' ? await runContinue(request) : await runEnrollment(request);
    return json(answer, answer.ok ? undefined : { status: 400 });
  } catch (e) {
    console.error('outreach enrol failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The run failed and stopped. Leads written before this point stay enrolled; run a preview to see where it stands. If the gl_seq_due index does not exist yet, nothing can be enrolled.' }, { status: 500 });
  }
}
