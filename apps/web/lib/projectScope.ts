// Turn the business-type / state / country dropdowns into a lead filter that
// can use the { project } index.
//
// The filters are patterns on the project NAME. Running such a pattern over
// 1.6M leads scans every index key (15–45 s). There are only ~250k project
// names, so match those in memory first (cached), then hand Mongo an exact
// $in list — or, when almost everything matches (country = USA), a $nin of
// the few that don't.
import { dbConnect } from '@/lib/db';
import { Project } from '@/lib/models';
import { countryRegex } from '@/lib/projectGeo';

export interface ProjectRef { query: string; name: string; folderId: string | null }
let cache: { at: number; projects: ProjectRef[]; names: string[] } | null = null;
// Every project's query, display name and folder, cached per instance for 3
// minutes: enough for the sidebar's project search without a round trip to Mongo.
export async function projectIndex(): Promise<ProjectRef[]> {
  if (cache && Date.now() - cache.at < 3 * 60 * 1000) return cache.projects;
  await dbConnect();
  const docs = (await Project.find().select('query name folderId -_id').lean()) as { query: string; name?: string; folderId?: string | null }[];
  const projects = docs.filter((p) => p.query).map((p) => ({ query: p.query, name: p.name || p.query, folderId: p.folderId || null }));
  cache = { at: Date.now(), projects, names: projects.map((p) => p.query) };
  return projects;
}
async function projectNames() {
  await projectIndex();
  return cache!.names;
}
// A rename, move or delete on this instance: do not serve the old list for 3 more minutes.
export function clearProjectIndex() { cache = null; }

// Project names that pass `test`, from the cached list — for filters that are a
// pattern on the project name but must reach MongoDB as an exact $in list.
export async function projectNamesWhere(test: (q: string) => boolean): Promise<string[]> {
  return (await projectNames()).filter(test);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const LIST_MAX = 40000; // names per $in/$nin (≈1.5 MB of query) — beyond that, fall back to the pattern

// Narrows match.project in place. Respects an existing project / folder scope.
// The business-type / region / country dropdowns as patterns on a project query.
// `test` is null when none of them is set.
export function projectFilter(ptypes: string[], pregions: string[], country: string) {
  const cRe = country ? countryRegex(country) : null;
  const startRe = ptypes.length ? new RegExp('^(' + ptypes.map(esc).join('|') + ')', 'i') : null;
  const endRe = pregions.length ? new RegExp('(^|\\s)(' + pregions.map(esc).join('|') + ')$', 'i') : null;
  const any = !!(startRe || endRe || cRe);
  const test = any ? (q: string) => (!startRe || startRe.test(q)) && (!endRe || endRe.test(q)) && (!cRe || cRe.test(q)) : null;
  return { startRe, endRe, cRe, test };
}

export async function applyProjectScope(match: Record<string, unknown>, ptypes: string[], pregions: string[], country: string) {
  const { startRe, endRe, cRe, test } = projectFilter(ptypes, pregions, country);
  if (!test) return;

  const cur = match.project as unknown;
  if (cur && typeof cur === 'object' && Array.isArray((cur as { $in?: string[] }).$in)) { // folder scope
    match.project = { $in: (cur as { $in: string[] }).$in.filter(test) };
    return;
  }
  if (typeof cur === 'string') { if (!test(cur)) match.project = ' __none__'; return; } // single project

  const names = await projectNames();
  const yes: string[] = [], no: string[] = [];
  for (const n of names) (test(n) ? yes : no).push(n);
  if (yes.length <= LIST_MAX) match.project = { $in: yes };
  else if (no.length <= LIST_MAX) match.project = { $nin: no };
  else {
    const conds: Record<string, unknown>[] = [];
    if (startRe) conds.push({ project: startRe });
    if (endRe) conds.push({ project: endRe });
    if (cRe) conds.push({ project: cRe });
    match.$and = ((match.$and as Record<string, unknown>[]) || []).concat(conds);
  }
}
