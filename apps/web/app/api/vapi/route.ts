import { dbConnect } from '@/lib/db';
import { Lead, LeadGroup, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Vapi (vapi.ai) outbound-call proxy. The dashboard calls a group's leads one
// by one: POST creates a call, GET ?id= polls it, GET ?group= builds the queue.
// Needs three env vars: VAPI_API_KEY (private key), VAPI_ASSISTANT_ID (which
// assistant speaks), VAPI_PHONE_NUMBER_ID (which number dials out).
const VAPI = 'https://api.vapi.ai';

function envError(): string | null {
  const missing = ['VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID'].filter((k) => !process.env[k]);
  return missing.length ? `Missing env var(s): ${missing.join(', ')}. Add them to the Vercel project (Settings → Environment Variables) and redeploy.` : null;
}

const vapiHeaders = () => ({ Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' });

// Best-effort E.164 (Vapi only dials +country numbers). Handles the formats
// stored by the scraper: US "(786) 448-6232", Hungarian domestic "06 20 966 6000",
// already-international "+36 20 ...", and 00-prefixed international.
function toE164(raw?: string | null): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.startsWith('00') && d.length >= 10) return `+${d.slice(2)}`;
  if (d.startsWith('06') && (d.length === 10 || d.length === 11)) return `+36${d.slice(2)}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return null;
}

// GET ?group=<id> → the group's callable queue (saved order)
// GET ?id=<callId> → live status of one Vapi call
export async function GET(req: Request) {
  try {
    const u = new URL(req.url).searchParams;
    const id = u.get('id') || '';
    if (id) {
      const r = await fetch(`${VAPI}/call/${encodeURIComponent(id)}`, { headers: vapiHeaders(), cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return json({ ok: false, error: b?.message || `Vapi ${r.status}` }, { status: 502 });
      return json({ ok: true, status: b.status || '', endedReason: b.endedReason || '', startedAt: b.startedAt || '', endedAt: b.endedAt || '' });
    }
    const group = u.get('group') || '';
    if (!group) return json({ ok: false, error: 'group or id required' }, { status: 400 });
    await dbConnect();
    const g = await LeadGroup.findOne({ groupId: group }).select('name keys -_id').lean() as { name?: string; keys?: string[] } | null;
    if (!g) return json({ ok: false, error: 'group not found' }, { status: 404 });
    const keys = g.keys || [];
    const docs = await Lead.find({ dedupKey: { $in: keys } }).select('dedupKey name phone address -_id').lean();
    const byKey = new Map((docs as any[]).map((r) => [r.dedupKey, r]));
    const rows = keys.map((k) => byKey.get(k)).filter(Boolean).map((r: any) => ({
      dedupKey: r.dedupKey, name: r.name || '', phone: r.phone || '', address: r.address || '', e164: toE164(r.phone),
    }));
    return json({ ok: true, name: g.name, rows, envError: envError() });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'vapi failed' }, { status: 500 });
  }
}

// POST { phone, name?, address?, dedupKey? } → start one outbound call
export async function POST(req: Request) {
  try {
    const err = envError();
    if (err) return json({ ok: false, error: err }, { status: 400 });
    const b = await req.json();
    const e164 = toE164(String(b?.phone || ''));
    if (!e164) return json({ ok: false, error: `Not a dialable number: "${b?.phone || ''}"` }, { status: 400 });
    const name = String(b?.name || '').slice(0, 40);
    const r = await fetch(`${VAPI}/call`, {
      method: 'POST',
      headers: vapiHeaders(),
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: e164, name: name || undefined },
        // usable in the assistant prompt as {{businessName}} / {{businessAddress}}
        assistantOverrides: { variableValues: { businessName: String(b?.name || ''), businessAddress: String(b?.address || '') } },
        metadata: { source: 'gridleads', dedupKey: String(b?.dedupKey || '') },
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: body?.message ? String(body.message) : `Vapi ${r.status}` }, { status: 502 });
    return json({ ok: true, callId: body.id || '', status: body.status || 'queued' });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'call failed' }, { status: 500 });
  }
}
