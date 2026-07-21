import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Lead, Project, ProjectStat, NO_SITE } from '@/lib/models';

// One $group bucket per project — shared by the subset and full recompute paths.
export const GROUP_STAGE = {
  $group: {
    _id: '$project',
    total: { $sum: 1 },
    noWebsite: { $sum: { $cond: [{ $in: ['$websiteStatus', NO_SITE] }, 1, 0] } },
    hot: { $sum: { $cond: [{ $eq: ['$leadTemperature', 'HOT'] }, 1, 0] } },
    email: { $sum: { $cond: [{ $and: [{ $ne: ['$email', ''] }, { $ne: ['$email', null] }] }, 1, 0] } },
    reviews: { $sum: { $cond: [{ $gt: ['$reviewsCount', 0] }, 1, 0] } },
    reviewsSum: { $sum: { $ifNull: ['$reviewsCount', 0] } },
    ai: { $sum: { $cond: [{ $gt: ['$aiAt', ''] }, 1, 0] } },
    oppSum: { $sum: { $ifNull: ['$opportunityScore', 0] } },
  },
} as const;

// Drop the gzipped /api/projects payload so the next GET rebuilds it from the
// ProjectStat collection (cheap — no lead scan).
export async function invalidateProjectsCache() {
  await dbConnect();
  await mongoose.connection.db!.collection('caches').deleteOne({ key: 'projects' });
}

const ZERO = { total: 0, noWebsite: 0, hot: 0, email: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0 };

function statSet(project: string, c: Record<string, number>, at: string) {
  return {
    project, updatedAt: at,
    total: c.total || 0, noWebsite: c.noWebsite || 0, hot: c.hot || 0, email: c.email || 0,
    reviews: c.reviews || 0, reviewsSum: c.reviewsSum || 0, ai: c.ai || 0, oppSum: c.oppSum || 0,
  };
}

// Recompute the counters for JUST these projects — walks only their leads via
// the project index, so it is cheap enough to run on every write that changes
// counts (scraper add, sync batch, review save, status edit, delete…).
export async function recomputeProjectStats(projects: (string | null | undefined)[]) {
  const uniq = [...new Set(projects.filter(Boolean))] as string[];
  if (!uniq.length) return;
  await dbConnect();
  const rows = await Lead.aggregate([{ $match: { project: { $in: uniq } } }, GROUP_STAGE]);
  const at = new Date().toISOString();
  const by = new Map((rows as { _id: string }[]).map((r) => [r._id, r as unknown as Record<string, number>]));
  await ProjectStat.bulkWrite(uniq.map((p) => ({
    updateOne: { filter: { project: p }, update: { $set: statSet(p, by.get(p) || ZERO, at) }, upsert: true },
  })), { ordered: false });
  await invalidateProjectsCache();
}

// Full rebuild over every lead — the ⟳ Recount button and the one-time
// bootstrap. A single $group over 1.2M leads → 100k+ buckets exceeds the 100MB
// group limit on the shared Atlas tier (allowDiskUse is ignored there), so the
// project-key space is partitioned into contiguous ranges. Each range counts
// AND writes entirely inside Mongo via $merge — pulling the buckets into the
// serverless function and bulk-writing them back blew Vercel's 60s limit
// mid-write and left partial counters.
export async function recomputeAllProjectStats(): Promise<number> {
  await dbConnect();
  const db = mongoose.connection.db!;
  const leadsColl = db.collection('leads');
  const names = ((await Project.find().select('query -_id').lean()) as { query: string }[])
    .map((p) => p.query).filter(Boolean).sort();
  const at = new Date().toISOString();
  if (!names.length) { await ProjectStat.deleteMany({}); await invalidateProjectsCache(); return 0; }

  // $merge requires a unique index on its join key
  await db.collection('projectstats').createIndex({ project: 1 }, { unique: true });

  const N = Math.min(40, names.length);
  const bounds: string[] = [];
  for (let i = 1; i < N; i++) bounds.push(names[Math.floor((i * names.length) / N)]);
  const ranges: [string | null, string | null][] = [];
  let lo: string | null = null;
  for (const b of bounds) { ranges.push([lo, b]); lo = b; }
  ranges.push([lo, null]);

  let idx = 0;
  const worker = async () => {
    while (idx < ranges.length) {
      const [a, b] = ranges[idx++];
      const range: Record<string, string> = {};
      if (a !== null) range.$gte = a;
      if (b !== null) range.$lt = b;
      const match = Object.keys(range).length ? { project: range } : {};
      await leadsColl.aggregate([
        { $match: match },
        GROUP_STAGE,
        { $project: { _id: 0, project: '$_id', total: 1, noWebsite: 1, hot: 1, email: 1, reviews: 1, reviewsSum: 1, ai: 1, oppSum: 1, updatedAt: { $literal: at } } },
        { $merge: { into: 'projectstats', on: 'project', whenMatched: 'replace', whenNotMatched: 'insert' } },
      ]).toArray(); // toArray() drives the pipeline; $merge emits no rows
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await ProjectStat.deleteMany({ updatedAt: { $lt: at } }); // projects whose leads are gone
  await invalidateProjectsCache();
  return ProjectStat.estimatedDocumentCount();
}
