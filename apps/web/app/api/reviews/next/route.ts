import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/reviews/next?project=&folder=
//   The most-recently-scraped business that has NO reviews yet AND has reviews to
//   scrape (reviewCount > 0) AND can be opened on Maps (cid or mapsUrl). Returns
//   one business, or { done:true } when none remain. This is what makes the
//   scraper skip businesses that already have reviews.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';
    // dedupKeys other parallel windows are scraping right now — skip them so two
    // windows never claim the same business.
    // Newline-delimited (the extension joins with "\n") so dedupKeys that contain a
    // comma ("name|lat|lng" fallback) aren't split into non-matching fragments.
    const exclude = (u.get('exclude') || '').split('\n').map((s) => s.trim()).filter(Boolean);

    const match: Record<string, unknown> = {
      reviewsScrapedAt: { $in: [null, ''] },       // not done yet
      reviewCount: { $gt: 0 },                       // actually has reviews
      $or: [{ cid: { $nin: [null, ''] } }, { mapsUrl: { $nin: [null, ''] } }], // openable
    };
    if (exclude.length) match.dedupKey = { $nin: exclude };
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query -_id').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (project) {
      match.project = project;
    }

    const doc = await Lead.findOne(match)
      .sort({ scrapedAt: -1, _id: -1 })             // most recent business first
      .select('project dedupKey name cid placeId mapsUrl reviewCount -_id')
      .lean() as Record<string, unknown> | null;

    if (!doc) return json({ ok: true, done: true });
    return json({ ok: true, done: false, business: doc });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'next failed' }, { status: 500 });
  }
}
