// Changelog feed — reads the activity log (lib/activity.ts).
//
//   GET /api/activity?groups=&q=&project=&from=&to=&page=&pageSize=
//     groups  comma list of type prefixes ("leads,email"); empty = everything
//     q       substring anywhere in the event (business, email, field, value…)
//     project substring of the project
//     from/to ISO timestamps
//   → { ok, rows, total, summary: { [type]: { events, n } } }   (summary on page 1 only)
import { activityColl } from '@/lib/activity';
import { CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(req: Request) {
  try {
    const u = new URL(req.url).searchParams;
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(u.get('pageSize') || '100', 10) || 100));
    const groups = (u.get('groups') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const q = (u.get('q') || '').trim().toLowerCase();
    const project = (u.get('project') || '').trim();
    const from = u.get('from'), to = u.get('to');

    // the time window alone drives the summary tiles; the other filters narrow the list
    const window: Record<string, unknown> = {};
    const ts: Record<string, Date> = {};
    if (from && !isNaN(Date.parse(from))) ts.$gte = new Date(from);
    if (to && !isNaN(Date.parse(to))) ts.$lte = new Date(to);
    if (Object.keys(ts).length) window.ts = ts;

    const match: Record<string, unknown> = { ...window };
    if (groups.length) match.type = new RegExp('^(' + groups.map(esc).join('|') + ')\\.');
    if (project) match.project = new RegExp(esc(project), 'i');
    if (q) match.text = new RegExp(esc(q));

    const c = await activityColl();
    const [docs, total, summary] = await Promise.all([
      c.find(match).sort({ ts: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).project({ text: 0 }).toArray(),
      c.countDocuments(match),
      page === 1
        ? c.aggregate([{ $match: window }, { $group: { _id: '$type', events: { $sum: 1 }, n: { $sum: { $ifNull: ['$n', 0] } } } }]).toArray()
        : Promise.resolve(null),
    ]);
    const rows = docs.map(({ _id, ts: at, ...r }) => ({ id: String(_id), at: (at as Date).toISOString(), ...r }));
    return json({
      ok: true, rows, total,
      summary: summary ? Object.fromEntries(summary.map((s) => [s._id, { events: s.events, n: s.n }])) : undefined,
    });
  } catch (e: any) {
    return json({ ok: false, rows: [], total: 0, error: e?.message || 'activity query failed' }, { status: 500 });
  }
}
