import { dbConnect } from '@/lib/db';
import { Lead, NO_SITE } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/stats — live headline counts for the landing page.
//   totalLeads          → every scraped business
//   leadsWithoutWebsite → websiteStatus in NO_SITE, or no website URL and no status yet
//   hotLeads            → leadTemperature === 'HOT' (the CRM's canonical hot flag)
export async function GET() {
  try {
    await dbConnect();
    const agg = await Lead.aggregate([
      { $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        leadsWithoutWebsite: { $sum: { $cond: [{ $or: [
          { $in: ['$websiteStatus', NO_SITE] },
          { $and: [
            { $eq: [{ $ifNull: ['$website', ''] }, ''] },
            { $eq: [{ $ifNull: ['$websiteStatus', ''] }, ''] },
          ] },
        ] }, 1, 0] } },
        hotLeads: { $sum: { $cond: [{ $eq: ['$leadTemperature', 'HOT'] }, 1, 0] } },
      } },
    ]).allowDiskUse(true);
    const m = (agg as { totalLeads?: number; leadsWithoutWebsite?: number; hotLeads?: number }[])[0] || {};
    return Response.json({
      totalLeads: m.totalLeads || 0,
      leadsWithoutWebsite: m.leadsWithoutWebsite || 0,
      hotLeads: m.hotLeads || 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'stats failed';
    return Response.json({ error: msg }, { status: 500 });
  }
}
