import { dbConnect } from '@/lib/db';
import { Tag, Lead, CORS, json } from '@/lib/models';

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
  await Tag.updateOne({ name }, { $set: { name, color } }, { upsert: true });
  return json({ ok: true, name, color });
}

// DELETE /api/tags  { name }  → remove the tag everywhere
export async function DELETE(req: Request) {
  await dbConnect();
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (name) {
    await Tag.deleteOne({ name });
    await Lead.updateMany({ tags: name }, { $pull: { tags: name } });
  }
  return json({ ok: true });
}
