import { CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { campaignState } from '@/lib/campaignState';
import { readHeartbeat } from '@/lib/dispatcher';
import { patchSettings } from '@/lib/outreachSettings';
import type { OutreachSettings } from '@/lib/outreachSettings';
import { cleanPostmaster } from '@/lib/outreachReport.mjs';
import { GATE } from '@/lib/campaignGate.mjs';
import { normalizeEmail } from '@/lib/inboxClassify.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const today = () => new Date().toISOString().slice(0, 10);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00.000Z')) && Date.parse(v + 'T00:00:00.000Z') <= Date.now();

// GET /api/outreach/control
// The state of the day: whether sending is allowed and why not, each sender's
// limit of today and tomorrow, the send loop's heartbeat, and the values
// entered by hand. The gate here is the same one the send round asks.
export async function GET() {
  try {
    const heartbeat = await readHeartbeat();
    const state = await campaignState(heartbeat.lastTickAt);
    return json({ ok: true, ...state, heartbeat, limits: GATE });
  } catch (e) {
    console.error('outreach control state failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The state could not be loaded.' }, { status: 500 });
  }
}

// POST /api/outreach/control
//   { postmaster: { spamRate, date } }      the Gmail spam rate read from Postmaster Tools
//   { seed: { inbox, of, date? } }          the result of a seed test
//   { seedAddresses: [...] }                the test mailboxes
//   { authConfirmed: true | false }         SPF, DKIM and DMARC all pass, seen by the operator
//   { repliesReviewed: true }               the operator has read the replies
// Each is stored with its date; they are what the gate judges by.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const patch: Partial<OutreachSettings> = {};
    const said: string[] = [];
    if (b?.postmaster !== undefined) {
      const r = cleanPostmaster(b.postmaster) as { value?: { spamRate: number; date: string }; error?: string };
      if (!r.value) return json({ ok: false, error: r.error || 'The spam rate could not be read.' }, { status: 400 });
      patch.postmaster = r.value;
      said.push(`Postmaster spam rate ${r.value.spamRate} % as of ${r.value.date}`);
    }
    if (b?.seed !== undefined) {
      const inbox = Number(b.seed?.inbox), of = Number(b.seed?.of);
      const date = b.seed?.date === undefined || b.seed?.date === '' ? today() : b.seed.date;
      if (!Number.isInteger(inbox) || !Number.isInteger(of) || of < 1 || of > 50 || inbox < 0 || inbox > of) return json({ ok: false, error: 'Enter how many of the test mailboxes got the email in the inbox, and how many there were.' }, { status: 400 });
      if (!isDay(date)) return json({ ok: false, error: 'The date of the seed test must be a day that is not in the future, as YYYY-MM-DD.' }, { status: 400 });
      patch.seed = { inbox, of, date };
      said.push(`seed test ${inbox} of ${of} in the inbox on ${date}`);
    }
    if (b?.seedAddresses !== undefined) {
      const list = [...new Set((Array.isArray(b.seedAddresses) ? b.seedAddresses : []).map((a: unknown) => normalizeEmail(String(a))).filter(Boolean))] as string[];
      if (list.length > 10) return json({ ok: false, error: 'At most 10 seed addresses.' }, { status: 400 });
      patch.seedAddresses = list;
      said.push(`${list.length} seed ${list.length === 1 ? 'address' : 'addresses'}`);
    }
    if (b?.authConfirmed !== undefined) {
      patch.authConfirmedAt = b.authConfirmed === true ? today() : '';
      said.push(b.authConfirmed === true ? 'SPF, DKIM and DMARC confirmed as passing' : 'the SPF, DKIM and DMARC confirmation withdrawn');
    }
    if (b?.repliesReviewed === true) {
      patch.repliesReviewedAt = new Date().toISOString();
      said.push('replies read');
    }
    if (!said.length) return json({ ok: false, error: 'nothing to save' }, { status: 400 });
    const settings = await patchSettings(patch);
    await logActivity({ type: 'outreach.control', n: 1, title: `Outreach control: ${said.join('; ')}`, data: { changed: Object.keys(patch) } });
    return json({ ok: true, settings });
  } catch (e) {
    console.error('outreach control save failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'That could not be saved.' }, { status: 500 });
  }
}
