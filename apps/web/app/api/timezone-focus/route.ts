import { dbConnect } from '@/lib/db';
import { TimezoneFocus, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/timezone-focus  { q, label }
// Tells the standalone timezone map which business to highlight. The map polls
// for this, so an already-open tab updates in place — no new tab, no focus steal.
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const q = String(b.q || '').trim();
  if (!q) return json({ ok: false, error: 'q required' }, { status: 400 });

  const label = String(b.label || '').trim();
  const ts = Date.now();
  await TimezoneFocus.updateOne(
    { key: 'current' },
    { $set: { key: 'current', q, label, ts } },
    { upsert: true },
  );
  return json({ ok: true, ts });
}
