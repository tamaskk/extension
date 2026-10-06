// The lead table's filter as a MongoDB match: one place that turns the query
// parameters of GET /api/leads into a query. Server code.
//
// The lead table and the enrolment of leads into a sequence both read it. If
// "the leads this filter shows" were written twice, a preview could count one
// set of leads and the enrolment write to another.
import { Project, LeadGroup, NO_SITE, descendantFolderIds } from '@/lib/models';
import { applyProjectScope } from '@/lib/projectScope';
import { applySearch } from '@/lib/searchIndex';

// "has an email": a non-empty string. Written as $gt '' (not $nin ['', null]) so
// the query implies the filter of the partial index gl_email_opp and can use it.
export const HAS_EMAIL = { $gt: '' };

// The scope part: project or folder, group, the chip filter, categories and
// the business type / state / country dropdowns.
export async function leadScopeMatch(u: URLSearchParams): Promise<Record<string, unknown>> {
  const project = u.get('project') || '';
  const folder = u.get('folder') || '';
  const filter = u.get('filter') || 'all';
  const match: Record<string, unknown> = {};
  if (folder) {
    const ids = await descendantFolderIds(folder); // include nested sub-folders
    const projs = await Project.find({ folderId: { $in: ids } }).select('query').lean();
    match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
  } else if (project) {
    match.project = project;
  }
  const groupId = u.get('group') || '';
  if (groupId) { // scope to a saved lead group's members
    const g = await LeadGroup.findOne({ groupId }).select('keys -_id').lean() as { keys?: string[] } | null;
    match.dedupKey = { $in: g?.keys || [] };
  }
  if (filter === 'nowebsite') match.websiteStatus = { $in: NO_SITE };
  else if (filter === 'haswebsite') match.websiteStatus = 'HAS_WEBSITE';
  else if (filter === 'hot') match.leadTemperature = 'HOT';
  else if (filter === 'email') match.email = HAS_EMAIL;
  else if (filter === 'hasreviews') match.reviewsCount = { $gt: 0 };
  else if (filter === 'hasai') match.aiAt = { $gt: '' };
  const cats = u.getAll('cat').filter(Boolean);
  if (cats.length) match.category = { $in: cats };
  await applyProjectScope(match, u.getAll('ptype').filter(Boolean), u.getAll('pregion').filter(Boolean), u.get('country') || '');
  return match;
}

// The rest, added onto a scope match: the email and phone dropdowns and the search box.
export async function applyLeadFilters(match: Record<string, unknown>, u: URLSearchParams): Promise<void> {
  // dropdown filters — combine with the chip above and with each other
  const and: Record<string, unknown>[] = [];
  const EMPTY = { $in: ['', null] }, SET = { $nin: ['', null] }; // SET: phone only — email uses HAS_EMAIL
  const emailF = u.get('email') || '';
  if (emailF === 'has') and.push({ email: HAS_EMAIL });
  else if (emailF === 'none') and.push({ email: EMPTY });
  else if (emailF === 'todo') and.push({ email: EMPTY, websiteStatus: 'HAS_WEBSITE', emailCheckedAt: EMPTY });         // has a site, never checked
  else if (emailF === 'checked') and.push({ email: EMPTY, emailCheckedAt: { $gt: '' }, emailStatus: { $ne: 'error' } }); // site read, nothing on it
  else if (emailF === 'miss') and.push({ email: EMPTY, emailCheckedAt: { $gt: '' } });                                  // searched, not found (none + unreadable)
  else if (emailF === 'failed') and.push({ email: EMPTY, emailStatus: 'error' });                                       // site could not be read
  const phoneF = u.get('phone') || '';
  if (phoneF === 'has') and.push({ phone: SET });
  else if (phoneF === 'none') and.push({ phone: EMPTY });
  if (and.length) match.$and = ((match.$and as Record<string, unknown>[]) || []).concat(and);
  await applySearch(match, (u.get('search') || '').trim());
}

// Scope and filters together: exactly the leads the table lists for these parameters.
export async function leadMatch(u: URLSearchParams): Promise<Record<string, unknown>> {
  const match = await leadScopeMatch(u);
  await applyLeadFilters(match, u);
  return match;
}
