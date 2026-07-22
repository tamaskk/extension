import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { dbConnect } from '@/lib/db';
import { SavedSearch, User } from '@/lib/models';
import { checkCron } from '@/lib/cronAuth';
import { buildQuery, leadsCollection, SearchFilters } from '@/lib/leads';
import { sendMail, radarAlertHtml } from '@/lib/mailer';
import { logEvent, logError } from '@/lib/monitoring';

// Lead radar: for each saved search with an alert, count NEW leads since the
// last run. ObjectIds are monotonic — "new" = _id > lastMaxId. First run just
// baselines (no email flood on day one).
export async function GET(req: NextRequest) {
  const denied = checkCron(req);
  if (denied) return denied;
  await dbConnect();

  const now = new Date();
  const searches = await SavedSearch.find({ alert: { $ne: 'off' } }).limit(500).lean() as unknown as
    { _id: unknown; userId: unknown; name: string; filters: SearchFilters; alert: string; lastMaxId: ObjectId | null; lastRunAt: Date | null }[];

  const col = await leadsCollection();
  let sent = 0;
  const results: { id: string; newCount: number }[] = [];

  for (const search of searches) {
    // Weekly alerts only fire if 7 days passed since the last run.
    if (search.alert === 'weekly' && search.lastRunAt && now.getTime() - new Date(search.lastRunAt).getTime() < 6.5 * 86400_000) continue;
    if (search.alert === 'daily' && search.lastRunAt && now.getTime() - new Date(search.lastRunAt).getTime() < 20 * 3600_000) continue;

    try {
      const maxDoc = await col.find(buildQuery(search.filters)).sort({ _id: -1 }).limit(1).project({ _id: 1 }).toArray();
      const currentMax = maxDoc[0]?._id as ObjectId | undefined;

      let newCount = 0;
      if (search.lastMaxId && currentMax && String(currentMax) !== String(search.lastMaxId)) {
        newCount = await col.countDocuments({ ...buildQuery(search.filters), _id: { $gt: search.lastMaxId } });
      }

      await SavedSearch.updateOne(
        { _id: search._id },
        { $set: { lastRunAt: now, lastCount: newCount, ...(currentMax ? { lastMaxId: currentMax } : {}) } },
      );

      if (newCount > 0) {
        const user = await User.findById(search.userId).select('email emailVerifiedAt').lean() as { email: string; emailVerifiedAt: Date | null } | null;
        if (user?.emailVerifiedAt) {
          const appUrl = process.env.APP_URL || 'http://localhost:3010';
          await sendMail(user.email, `${newCount} új lead — „${search.name}” | TokenLeads radar`, radarAlertHtml(search.name, newCount, appUrl));
          sent++;
        }
      }
      results.push({ id: String(search._id), newCount });
    } catch (e) {
      logError('radar_search_failed', e, { searchId: String(search._id) });
    }
  }

  logEvent('radar_run', { searches: searches.length, sent });
  return NextResponse.json({ ok: true, scanned: searches.length, sent, results });
}
