// Autocomplete of businesses that HAVE scraped reviews — for the Reviews view's
// business filter dropdown. Web-only → protected by the auth middleware.
import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(req: Request) {
  await dbConnect();
  const u = new URL(req.url).searchParams;
  const q = (u.get('q') || '').trim();
  const match: Record<string, unknown> = { reviewsCount: { $gt: 0 } };
  if (q) match.name = new RegExp(esc(q), 'i');
  const leads = await Lead.find(match).sort({ reviewsCount: -1 }).limit(20).select('dedupKey name address project reviewsCount -_id').lean();
  return json({
    ok: true,
    businesses: (leads as any[]).map((l) => ({ dedupKey: l.dedupKey, name: l.name || l.dedupKey, address: l.address || '', reviewsCount: l.reviewsCount || 0 })),
  });
}
