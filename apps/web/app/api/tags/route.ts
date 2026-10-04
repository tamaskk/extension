import { dbConnect } from '@/lib/db';
import { Tag, Lead, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/tags  → { tags: [{ name, color }] }  (the autocomplete registry)
export async function GET() {
  try {
    await dbConnect();
    const tags = await Tag.find().sort({ name: 1 }).select('name color -_id').lean();
    return json({ tags });
  } catch (e: any) {
    return json({ tags: [], error: e?.message || 'tags query failed' }, { status: 500 });
  }
}

// POST /api/tags  { name, color }  → create or recolor a tag
export async function POST(req: Request) {
  await dbConnect();
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return json({ ok: false, error: 'name required' }, { status: 400 });
  const color = String(b.color || '#6366f1');
  const res = await Tag.updateOne({ name }, { $set: { name, color } }, { upsert: true });
  if (res.upsertedCount || res.modifiedCount) await logActivity({ type: 'tag.edit', n: 1, title: res.upsertedCount ? `Tag created: ${name}` : `Tag recolored: ${name}`, data: { name, color } });
  return json({ ok: true, name, color });
}

// DELETE /api/tags  { name }  → remove the tag everywhere
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (name) {
    await Tag.deleteOne({ name });
    const r = await Lead.updateMany({ tags: name }, { $pull: { tags: name } });
    await logActivity({ type: 'tag.delete', n: 1, title: `Tag deleted: ${name} (removed from ${r.modifiedCount || 0} lead(s))`, data: { name, leads: r.modifiedCount || 0 } });
  }
  return json({ ok: true });
}
