import { dbConnect } from '@/lib/db';
import { Suppression, CORS, json } from '@/lib/models';
import { suppress, suppressDomain, unsuppress } from '@/lib/suppression';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/suppressions?search=
// The suppression list, newest first: who is never written to, and why.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const search = (new URL(req.url).searchParams.get('search') || '').trim().toLowerCase().slice(0, 100);
    // a prefix on the indexed, lower-cased address; never a pattern built from the input
    const match = search ? { email: { $gte: search, $lt: search + '￿' } } : {};
    const rows = await Suppression.find(match).sort({ createdAt: -1 }).limit(200).select('-_id').lean();
    return json({ ok: true, rows, total: await Suppression.estimatedDocumentCount() });
  } catch (e) {
    console.error('suppression list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The suppression list could not be loaded.' }, { status: 500 });
  }
}

// POST /api/outreach/suppressions  { action: 'add' | 'addDomain' | 'remove', value, note? }
// The operator's own hand on the list. Removing is here and nowhere else: no
// sequence, mailbox round or other automatic path can lift a suppression. It is
// for a block that was a mistake, or for a person who asks to be written to again.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const value = String(b?.value || '').trim().slice(0, 320);
    if (!value) return json({ ok: false, error: 'Enter an address or a domain.' }, { status: 400 });
    if (b?.action === 'remove') {
      const r = await unsuppress(value);
      return r.removed ? json({ ok: true }) : json({ ok: false, error: 'That address or domain is not on the list.' }, { status: 404 });
    }
    const r = b?.action === 'addDomain' ? await suppressDomain(value, 'manual', 'operator') : b?.action === 'add' ? await suppress(value, 'manual', 'operator', String(b?.note || '').slice(0, 300)) : null;
    if (!r) return json({ ok: false, error: 'nothing to do' }, { status: 400 });
    if (r.added) return json({ ok: true });
    const why = r.why === 'exists' ? 'It is on the list already.' : r.why === 'common_provider' ? 'That is a mailbox provider, not a company domain: suppress the address instead.' : 'That is not an address or a domain.';
    return json({ ok: false, error: why }, { status: 400 });
  } catch (e) {
    console.error('suppression change failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'That could not be saved.' }, { status: 500 });
  }
}
