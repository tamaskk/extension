import { CORS, json } from '@/lib/models';
import { MAX_KEYS, suggestLeads } from '@/lib/enroll';
import { COUNTRY_NAMES } from '@/lib/countries';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/suggest  { sequenceId, country, n, exclude?: [dedupKey] }
// Leads to put into a sequence: the best-scored leads of the country that pass
// every enrolment rule right now (an address that takes mail, not suppressed,
// not written to before, the sequence's language, a known time zone, one per
// company).  → { ok, picks: [{ project, key, name, to, sender, category, score }], examined, skipped }
// Writes nothing; POST only because the list of leads to leave out can be long.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const sequenceId = String(b?.sequenceId || '');
    const country = String(b?.country || '');
    if (!sequenceId) return json({ ok: false, error: 'Choose a sequence.' }, { status: 400 });
    if (!COUNTRY_NAMES.includes(country)) return json({ ok: false, error: 'Choose a country.' }, { status: 400 });
    const n = Math.min(50, Math.max(1, Math.floor(Number(b?.n) || 5)));
    const exclude = (Array.isArray(b?.exclude) ? b.exclude : []).filter((k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200).slice(0, MAX_KEYS * 5);
    const answer = await suggestLeads(sequenceId, country, n, exclude);
    return json(answer, answer.ok ? undefined : { status: 400 });
  } catch (e) {
    console.error('outreach suggest failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The leads could not be picked.' }, { status: 500 });
  }
}
