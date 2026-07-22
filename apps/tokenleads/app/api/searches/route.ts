import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { SavedSearch } from '@/lib/models';
import { requireSessionOrKey, isResponse, jsonError } from '@/lib/apiUtil';
import { queryKey, SearchFilters } from '@/lib/leads';

const MAX_SAVED = 20;
const FILTER_KEYS = ['q', 'category', 'city', 'minRating', 'minReviews', 'temperature', 'websiteStatus', 'hasEmail', 'hasPhone'] as const;

function sanitizeFilters(raw: Record<string, unknown>): SearchFilters {
  const f: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) {
    if (raw[k] === undefined || raw[k] === '' || raw[k] === null || raw[k] === false) continue;
    f[k] = k === 'minRating' || k === 'minReviews' ? Number(raw[k]) : k === 'hasEmail' || k === 'hasPhone' ? true : String(raw[k]);
  }
  return f as SearchFilters;
}

export async function GET(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  await dbConnect();
  const items = await SavedSearch.find({ userId: s.uid }).sort({ createdAt: -1 }).lean() as unknown as
    { _id: unknown; name: string; filters: Record<string, unknown>; alert: string; lastRunAt: Date | null; lastCount: number }[];
  return NextResponse.json({
    ok: true,
    items: items.map((i) => ({ id: String(i._id), name: i.name, filters: i.filters, alert: i.alert, lastRunAt: i.lastRunAt, lastCount: i.lastCount })),
  });
}

export async function POST(req: NextRequest) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim().slice(0, 80);
  if (!name) return jsonError(400, 'name required');
  const filters = sanitizeFilters(body?.filters || {});
  if (!Object.keys(filters).length) return jsonError(400, 'at least one filter required');
  const alert = ['off', 'daily', 'weekly'].includes(body?.alert) ? body.alert : 'off';

  await dbConnect();
  const count = await SavedSearch.countDocuments({ userId: s.uid });
  if (count >= MAX_SAVED) return jsonError(409, `max ${MAX_SAVED} saved searches`);

  // queryKey without page — the alert scans the whole filter set, not one page.
  const key = queryKey({ ...filters, page: 1 });
  try {
    const doc = await SavedSearch.create({ userId: s.uid, name, filters, queryKey: key, alert });
    return NextResponse.json({ ok: true, id: String(doc._id) });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000) return jsonError(409, 'this filter combination is already saved');
    throw e;
  }
}
