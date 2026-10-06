import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';
import { logActivity, logLeadEdit, diffFields } from '@/lib/activity';
import { refreshSearchTokens, TOKEN_FIELDS } from '@/lib/searchIndex';
import { HAS_EMAIL, applyLeadFilters, leadScopeMatch } from '@/lib/leadMatch';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The sortable columns of the lead table (Dashboard.tsx ALL_COLUMNS). Anything
// else falls back to the default, so a request cannot sort by an arbitrary key.
const SORT_KEYS = new Set(['checked', 'name', 'category', 'rating', 'reviewCount', 'phone', 'email', 'websiteStatus',
  'opportunityScore', 'leadScore', 'leadTemperature', 'address', 'scrapedAt', 'salesStatus', 'call']);

// Map a dashboard sort key → a real document field. leadTemperature is derived
// from the opportunity score, so sorting by that matches it.
function sortField(key: string): string {
  if (!SORT_KEYS.has(key)) return 'opportunityScore';
  if (key === 'leadTemperature') return 'opportunityScore'; // temperature now follows opportunity
  return key;
}

// Sort spec that an index can serve. An `_id` tie-break is only added where a
// compound index ends in `_id` (gl_opp_sort, tl_leadscore_sort), and in the
// direction that lets the index be read forwards or backwards. On every other
// field `{ field, _id }` matched no index: MongoDB read all 1.6M leads and
// sorted them in memory (3-19 s), while `{ field }` alone walks the
// single-field index. Ties then come in index order, which is stable.
const TIE_BREAK = new Set(['opportunityScore', 'leadScore']);
function sortSpec(field: string, dir: 1 | -1): Record<string, 1 | -1> {
  return TIE_BREAK.has(field) ? { [field]: dir, _id: dir === -1 ? 1 : -1 } : { [field]: dir };
}

// GET /api/leads?project=&folder=&filter=&search=&sort=&dir=&page=&pageSize=
export async function GET(req: Request) {
  const started = performance.now();
  try {
    await dbConnect();
    const connected = performance.now();
    const u = new URL(req.url).searchParams;
    if (u.get('countChecked')) return json({ total: await Lead.countDocuments({ checked: true }) });
    const key = u.get('key');
    if (key) { // one lead by dedupKey — the map fetches a marker's details when it is clicked
      const doc = await Lead.findOne({ dedupKey: String(key) }).lean() as Record<string, unknown> | null;
      if (!doc) return json({ rows: [], total: 0 });
      const { _id, ...row } = doc;
      return json({ rows: [row], total: 1 });
    }
    const sort = u.get('sort') || 'opportunityScore';
    const dir = (parseInt(u.get('dir') || '-1', 10) === 1 ? 1 : -1) as 1 | -1;
    const page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(u.get('pageSize') || '50', 10) || 50));

    // the filter itself is built in lib/leadMatch.ts, shared with the sequence enrolment
    const match = await leadScopeMatch(u);
    // ?emailCounts=1 → just the two numbers of the email tile, counted live for
    // this scope (folder / project / business type / state / country).
    if (u.get('emailCounts')) {
      const [email, miss] = await Promise.all([
        Lead.countDocuments({ ...match, email: HAS_EMAIL }),
        Lead.countDocuments({ ...match, email: { $in: ['', null] }, emailCheckedAt: { $gt: '' } }),
      ]);
      return json({ ok: true, email, miss });
    }
    await applyLeadFilters(match, u);

    const field = sortField(sort);
    // Empty match (default "all leads" view) → estimatedDocumentCount reads the
    // collection metadata instantly instead of scanning 1.2M docs for a count.
    const isEmptyMatch = Object.keys(match).length === 0;
    const count = () => (isEmptyMatch ? Lead.estimatedDocumentCount() : Lead.countDocuments(match));
    // The count is often far slower than the page (a search: 52 ms of rows,
    // 5 s of counting), so the dashboard asks for the two separately:
    //   ?only=total → { total }            ?total=0 → rows without a count (total: -1)
    if (u.get('only') === 'total') {
      const total = await count();
      const done = performance.now();
      return json({ total }, undefined, { connect: connected - started, db: done - connected, total: done - started });
    }
    const [docs, total] = await Promise.all([
      Lead.find(match).sort(sortSpec(field, dir)).allowDiskUse(true).skip((page - 1) * pageSize).limit(pageSize).lean(),
      u.get('total') === '0' ? Promise.resolve(-1) : count(),
    ]);
    const rows = (docs as Record<string, unknown>[]).map(({ _id, ...r }) => r);
    const done = performance.now();
    // db = everything after the connection: scope lookups, the page and the count
    return json({ rows, total }, undefined, { connect: connected - started, db: done - connected, total: done - started });
  } catch (e: any) {
    return json({ rows: [], total: 0, error: e?.message || 'leads query failed' }, { status: 500 });
  }
}

// Add a single lead (one-by-one from the extension): { project:{query,name}, lead }
export async function POST(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    const proj = b.project; const lead = b.lead;
    if (!proj?.query || !lead?.dedupKey) return json({ ok: false, error: 'project.query and lead.dedupKey required' }, { status: 400 });
    const existing = await Lead.findOne({ dedupKey: lead.dedupKey }).select('project').lean() as { project?: string } | null;
    if (existing && existing.project !== proj.query) return json({ ok: true, skippedDuplicate: true, existingProject: existing.project });
    if (!existing) await logActivity({ type: 'leads.new', project: proj.query, source: 'extension', n: 1, keys: [lead.dedupKey], title: `+1 new lead: ${lead.name || lead.dedupKey}`,
      data: { leads: [{ key: lead.dedupKey, name: lead.name, category: lead.category, phone: lead.phone, website: lead.website, websiteStatus: lead.websiteStatus, email: lead.email }] } });
    await Project.updateOne({ query: proj.query }, { $set: { query: proj.query, name: proj.name || proj.query, createdAt: proj.createdAt || new Date().toISOString() } }, { upsert: true });
    const { _id, seq, sig, ...rest } = lead; // `seq` (sequence state) and `sig` are written by the server only
    // also by a dotted key ("seq.to") or an operator: only plain top-level fields are taken
    for (const k of Object.keys(rest)) if (k.includes('.') || k.startsWith('$')) delete rest[k];
    await Lead.updateOne({ project: proj.query, dedupKey: lead.dedupKey }, { $set: { ...rest, project: proj.query, dedupKey: lead.dedupKey } }, { upsert: true });
    await refreshSearchTokens([lead.dedupKey]);
    await recomputeProjectStats([proj.query]);
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'lead save failed' }, { status: 500 });
  }
}

// Update a lead: { project, dedupKey, checked?, tags?, websiteStatus?, opportunityScore? }
export async function PATCH(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    if (b.uncheckAll) {
      const r = await Lead.updateMany({ checked: true }, { $set: { checked: false } });
      if (r.modifiedCount) await logActivity({ type: 'lead.bulk', n: r.modifiedCount, title: `Uncheck all: ${r.modifiedCount} lead(s) unchecked` });
      return json({ ok: true, updated: r.modifiedCount || 0 });
    }
    if (b.addCall && b.addCall.id) { // append a Vapi call to the lead's history (Call tab)
      await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, {
        $push: { vapiCalls: { id: String(b.addCall.id), at: String(b.addCall.at || new Date().toISOString()), endedReason: String(b.addCall.endedReason || '') } },
      });
      await logActivity({ type: 'call.done', project: b.project, keys: [b.dedupKey], n: 1, title: `Call finished${b.addCall.endedReason ? ` — ${b.addCall.endedReason}` : ''}`, data: { callId: String(b.addCall.id), endedReason: String(b.addCall.endedReason || '') } });
      return json({ ok: true });
    }
    const set: Record<string, unknown> = {};
    if ('checked' in b) set.checked = !!b.checked;
    if ('call' in b) set.call = !!b.call;
    if ('tags' in b && Array.isArray(b.tags)) set.tags = b.tags.map((t: unknown) => String(t));
    if (typeof b.websiteStatus === 'string' && b.websiteStatus) set.websiteStatus = b.websiteStatus;
    if (b.opportunityScore != null && b.opportunityScore !== '' && !isNaN(Number(b.opportunityScore))) {
      const v = Math.max(0, Math.min(100, Math.round(Number(b.opportunityScore))));
      set.opportunityScore = v;
      set.leadTemperature = v >= 70 ? 'HOT' : v >= 40 ? 'WARM' : 'COLD'; // temperature follows opportunity
    }
    // generic single-field edit { field, value } from the detail modal
    if (typeof b.field === 'string') {
      const f = b.field; const val = b.value;
      const STR = new Set(['name', 'category', 'phone', 'email', 'website', 'address', 'mapsUrl', 'topPitch', 'placeId', 'cid', 'salesStatus', 'salesDate', 'notes', 'emailSubject', 'emailBody', 'smsBody']);
      const NUM = new Set(['rating', 'reviewCount', 'lat', 'lng', 'leadScore']);
      const WS = new Set(['HAS_WEBSITE', 'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION', 'NOT_WORKING', 'REDIRECTS']);
      const TEMP = new Set(['COLD', 'WARM', 'HOT']);
      if (STR.has(f)) set[f] = val == null ? '' : String(val);
      if (f === 'notes') set.notesAt = set.notes ? new Date().toISOString() : ''; // Notes view filter+sort key
      if (f === 'emailBody') set.emailAt = new Date().toISOString();
      if (f === 'smsBody') set.smsAt = new Date().toISOString();
      else if (NUM.has(f)) set[f] = (val === '' || val == null) ? null : (isNaN(Number(val)) ? undefined : Number(val));
      else if (f === 'websiteStatus' && WS.has(val)) set.websiteStatus = val;
      else if (f === 'leadTemperature' && TEMP.has(val)) set.leadTemperature = val;
      else if (f === 'checked') set.checked = !!val;
      else if (f === 'opportunityScore') { const v = Math.max(0, Math.min(100, Math.round(Number(val) || 0))); set.opportunityScore = v; set.leadTemperature = v >= 70 ? 'HOT' : v >= 40 ? 'WARM' : 'COLD'; }
      if (set[f] === undefined) delete set[f];
    }
    if (Object.keys(set).length) {
      // what the lead looked like before, so the Changelog can show old → new
      const prev = await Lead.findOne({ project: b.project, dedupKey: b.dedupKey }).select('name ' + Object.keys(set).join(' ')).lean() as Record<string, unknown> | null;
      await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: set });
      if (TOKEN_FIELDS.some((f) => f in set)) await refreshSearchTokens([b.dedupKey]);
      if (prev) {
        const derived = new Set(['notesAt', 'emailAt', 'smsAt']); // bookkeeping stamps, not edits
        await logLeadEdit(b.project, b.dedupKey, String(set.name ?? prev.name ?? ''), diffFields(prev, set, Object.keys(set).filter((f) => !derived.has(f))));
      }
      // only edits that change the sidebar counters trigger a recount
      if (['websiteStatus', 'opportunityScore', 'leadTemperature', 'email'].some((f) => f in set)) await recomputeProjectStats([b.project]);
    }
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'lead update failed' }, { status: 500 });
  }
}

// Delete leads: { items: [{ query, key }] } OR { allChecked: true } (every checked lead)
export async function DELETE(req: Request) {
  try {
    await dbConnect();
    const b = await req.json();
    if (b.allChecked) {
      const projs = await Lead.distinct('project', { checked: true });
      const gone = await Lead.find({ checked: true }).limit(1000).select('project dedupKey name phone email website -_id').lean();
      const r = await Lead.deleteMany({ checked: true });
      if (r.deletedCount) await logActivity({ type: 'leads.delete', n: r.deletedCount, keys: (gone as any[]).map((g) => g.dedupKey), title: `${r.deletedCount} checked lead(s) deleted`, data: { leads: gone, projects: projs } });
      await recomputeProjectStats(projs as string[]);
      return json({ ok: true, deleted: r.deletedCount || 0 });
    }
    const items: { query: string; key: string }[] = b.items || [];
    if (items.length) {
      const gone = await Lead.find({ dedupKey: { $in: items.slice(0, 1000).map((it) => it.key) } }).select('project dedupKey name phone email website -_id').lean();
      await Lead.bulkWrite(items.map((it) => ({ deleteOne: { filter: { project: it.query, dedupKey: it.key } } })), { ordered: false });
      await logActivity({ type: 'leads.delete', n: items.length, keys: items.slice(0, 1000).map((it) => it.key), project: items.length === 1 ? items[0].query : undefined,
        title: items.length === 1 ? `Lead deleted: ${(gone as any[])[0]?.name || items[0].key}` : `${items.length} lead(s) deleted`, data: { leads: gone } });
      await recomputeProjectStats(items.map((it) => it.query));
    }
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'lead delete failed' }, { status: 500 });
  }
}
