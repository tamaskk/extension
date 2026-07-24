import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// GET /api/notes?search=&page=&pageSize= → leads that have notes, most
// recently edited first. Full lead docs so the detail panel can open directly.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const search = (u.get('search') || '').trim();
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(u.get('pageSize') || '50', 10) || 50));

    const match: Record<string, unknown> = { notesAt: { $gt: '' } };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      match.$or = [{ name: rx }, { notes: rx }, { category: rx }, { address: rx }];
    }
    const [docs, total] = await Promise.all([
      Lead.find(match).sort({ notesAt: -1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Lead.countDocuments(match),
    ]);
    const rows = (docs as Record<string, unknown>[]).map(({ _id, ...r }) => r);
    return json({ ok: true, rows, total });
  } catch (e: any) {
    return json({ ok: false, rows: [], total: 0, error: e?.message || 'notes query failed' }, { status: 500 });
  }
}
