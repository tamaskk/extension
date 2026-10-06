// What the sidebar needs without the project list: per-folder sums of the
// project counters and the filter options. Built from the same join as the
// full /api/projects payload, cached in the `caches` collection.
import { dbConnect } from '@/lib/db';
import { Folder, Project, ProjectStat } from '@/lib/models';
import { recomputeAllProjectStats } from '@/lib/projectStats';
import { cachedData } from '@/lib/cache';
import { aggregateProjects } from '@/lib/sidebarAggregate.mjs';
import { parseProject } from '@/lib/projectFacets';
import { parseProjectGeo, OTHER_COUNTRY } from '@/lib/projectGeo';
import { makeCoverage } from '@/lib/coverage.mjs';
import { STATE_REGIONS } from '@/lib/regionNames';
import { COUNTRY_NAMES } from '@/lib/countries';
import { STATE_PLACES } from '@/lib/states';
import { COUNTRY_AREAS_BY_FILE } from '@/lib/countryAreas';
import type { ProjectSummary } from '@/lib/types';

// Join Project docs with their precomputed ProjectStat counters — no lead scan.
// First run (empty ProjectStat collection) bootstraps with a full recompute.
export async function computeProjects(): Promise<ProjectSummary[]> {
  await dbConnect();
  if (!(await ProjectStat.estimatedDocumentCount())) await recomputeAllProjectStats();
  const [projects, stats] = await Promise.all([
    Project.find().select('query name createdAt folderId -_id').lean(),
    ProjectStat.find().select('-_id -updatedAt').lean(),
  ]);
  const by = new Map((stats as any[]).map((s) => [s.project, s]));
  return (projects as any[]).map((p) => withCounters(p, by.get(p.query)));
}

// one project row from its document and its (possibly missing) counters
export function withCounters(p: { query: string; name?: string; createdAt?: string; folderId?: string | null }, c: Record<string, number> | undefined): ProjectSummary {
  const s = c || {};
  return {
    query: p.query, name: p.name || p.query, createdAt: p.createdAt || '', folderId: p.folderId || null,
    total: s.total || 0, noWebsite: s.noWebsite || 0, hot: s.hot || 0, email: s.email || 0, emailMiss: s.emailMiss || 0, emailTodo: s.emailTodo || 0,
    reviews: s.reviews || 0, reviewsSum: s.reviewsSum || 0, ai: s.ai || 0, oppSum: s.oppSum || 0,
  };
}

export interface FolderAggregate {
  projects: number; zero: number;
  total: number; noWebsite: number; hot: number; email: number; emailMiss: number; emailTodo: number;
  reviews: number; reviewsSum: number; ai: number; oppSum: number;
}
export interface SidebarAggregates {
  folders: Record<string, FolderAggregate>; // own projects only, by folder id
  ungrouped: FolderAggregate;
  all: FolderAggregate;
  facets: { types: string[]; regions: string[]; countries: [string, number][] };
  missing: Record<string, number>; // accurate coverage gap per state/city folder (lib/coverage.mjs)
}

export async function buildSidebarAggregates(): Promise<SidebarAggregates> {
  const [projects, folderDocs] = await Promise.all([
    computeProjects(),
    Folder.find().select('folderId name parentId -_id').lean() as Promise<{ folderId: string; name?: string; parentId?: string | null }[]>,
  ]);
  const existing = new Set(folderDocs.map((f) => f.folderId));
  const agg = aggregateProjects(projects, existing) as Omit<SidebarAggregates, 'facets' | 'missing'>;
  // filter options: the business types, regions and countries that occur in project queries
  const types = new Set<string>(); const regions = new Set<string>(); const countries = new Map<string, number>();
  for (const p of projects) {
    const f = parseProject(p.query);
    if (f?.type) types.add(f.type);
    if (f?.region) regions.add(f.region);
    const c = parseProjectGeo(p.query)?.country || OTHER_COUNTRY;
    countries.set(c, (countries.get(c) || 0) + 1);
  }
  return { ...agg, missing: coverageGaps(projects, folderDocs, existing), facets: { types: [...types].sort(), regions: [...regions].sort(), countries: [...countries].sort((a, b) => b[1] - a[1]) } };
}

const coverage = makeCoverage({ stateRegions: STATE_REGIONS, countryNames: COUNTRY_NAMES, statePlaces: STATE_PLACES, areasByFile: COUNTRY_AREAS_BY_FILE });

// The red "missing" badge of every state/city folder: reference places that no
// project under the folder names. Needs every project name in the subtree, which
// only the server has.
function coverageGaps(projects: ProjectSummary[], folders: { folderId: string; name?: string; parentId?: string | null }[], existing: Set<string>): Record<string, number> {
  const nameOf = new Map(folders.map((f) => [f.folderId, f.name || '']));
  const childIds = new Map<string, string[]>();
  for (const f of folders) if (f.parentId && existing.has(f.parentId)) childIds.set(f.parentId, [...(childIds.get(f.parentId) || []), f.folderId]);
  const partsOf = new Map<string, string[]>(); // project names + queries, by folder
  for (const p of projects) {
    if (!p.folderId || !existing.has(p.folderId)) continue;
    const arr = partsOf.get(p.folderId) || [];
    arr.push(p.query);
    if (p.name && p.name !== p.query) arr.push(p.name);
    partsOf.set(p.folderId, arr);
  }
  const out: Record<string, number> = {};
  for (const f of folders) {
    const name = f.name || '';
    if (coverage.accurateMissing(name, []) === undefined) continue; // a root, or no reference list: skip the work
    const parts: string[] = [];
    const seen = new Set<string>(); // guards against a parent cycle
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const s of (partsOf.get(id) || [])) parts.push(s);
      if (id !== f.folderId) parts.push(coverage.covRegionOf(nameOf.get(id) || ''));
      for (const c of (childIds.get(id) || [])) walk(c);
    };
    walk(f.folderId);
    const gap = coverage.accurateMissing(name, parts);
    if (gap !== undefined) out[f.folderId] = gap;
  }
  return out;
}

// Same freshness rule as the projects payload: 120 s, then served stale while
// it is rebuilt after the response. invalidateProjectsCache() drops it.
const TTL_MS = 120_000;
export function getSidebarAggregates(): Promise<SidebarAggregates> {
  return cachedData<SidebarAggregates>('sidebar', TTL_MS, buildSidebarAggregates);
}
