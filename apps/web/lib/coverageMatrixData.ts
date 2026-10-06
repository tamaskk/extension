// The coverage matrix payload: every region with a reference list, and for
// every business type how many of its places already have a project.
// Server only: it reads every project query.
import { dbConnect } from '@/lib/db';
import { Project } from '@/lib/models';
import { cachedData, writeCache } from '@/lib/cache';
import { covNorm } from '@/lib/coverage.mjs';
import { buildCoverageIndex, missingPlaces } from '@/lib/coverageMatrix.mjs';
import { COUNTRY_CITIES } from '@/lib/countries';
import { STATE_PLACES } from '@/lib/states';
import { COUNTRY_AREAS_BY_FILE } from '@/lib/countryAreas';

// cities: a country, checked against its city list. state: a US state, against
// its places. city: a city, against its areas.
export type CoverageRowKind = 'cities' | 'state' | 'city';
export interface CoverageRow { country: string; kind: CoverageRowKind; region: string; total: number }
export interface CoverageMatrix {
  rows: CoverageRow[];
  types: { key: string; label: string; projects: number }[];
  present: Record<string, Record<number, number>>;
  at: number;
}

function referenceRows(): (CoverageRow & { names: string[] })[] {
  const rows: (CoverageRow & { names: string[] })[] = [];
  // the area files are named without spaces ("hongkong")
  const countryOfFile = new Map(Object.keys(COUNTRY_CITIES).map((c) => [covNorm(c).replace(/ /g, ''), c]));
  for (const [country, cities] of Object.entries(COUNTRY_CITIES)) rows.push({ country, kind: 'cities', region: country, total: cities.length, names: cities });
  for (const [state, places] of Object.entries(STATE_PLACES)) rows.push({ country: 'USA', kind: 'state', region: state, total: places.length, names: places.map((p) => p[0]) });
  for (const [file, cities] of Object.entries(COUNTRY_AREAS_BY_FILE)) {
    const country = countryOfFile.get(covNorm(file).replace(/ /g, '')) || file;
    for (const [city, areas] of Object.entries(cities)) rows.push({ country, kind: 'city', region: city, total: areas.length, names: areas });
  }
  return rows;
}

async function buildCoverageMatrix(): Promise<CoverageMatrix> {
  const reference = referenceRows();
  const { types, present } = buildCoverageIndex(await projectQueries(), reference);
  return { rows: reference.map(({ country, kind, region, total }) => ({ country, kind, region, total })), types, present, at: Date.now() };
}

async function projectQueries(): Promise<string[]> {
  await dbConnect();
  const projects = await Project.find().select('query -_id').lean() as { query?: string }[];
  return projects.map((p) => p.query || '');
}

export const COVERAGE_KINDS: CoverageRowKind[] = ['cities', 'state', 'city'];
export const coverageCountries = () => Object.keys(COUNTRY_CITIES);

// What one type still lacks in one country, in the shape the extension's
// "Load batches from JSON" reads: the region is the batch suffix, the missing
// places are its searches. Regions with nothing missing are left out. Not
// cached: it is asked for one column at a time, right before a run.
export async function missingBatches(type: string, country: string, kind: CoverageRowKind): Promise<{ city: string; areas: string[] }[]> {
  const reference = referenceRows();
  const missing = missingPlaces(await projectQueries(), reference, type) as string[][];
  const out: { city: string; areas: string[] }[] = [];
  reference.forEach((r, i) => { if (r.country === country && r.kind === kind && missing[i].length) out.push({ city: r.region, areas: missing[i] }); });
  return out;
}

// Same freshness rule as the sidebar: 120 s, then served stale while it is
// rebuilt after the response. `fresh` rebuilds inside the request, for the
// screen's Refresh button after a batch has just finished.
const KEY = 'coverage-matrix';
const TTL_MS = 120_000;
export async function getCoverageMatrix(fresh = false): Promise<CoverageMatrix> {
  if (!fresh) return cachedData<CoverageMatrix>(KEY, TTL_MS, buildCoverageMatrix);
  const data = await buildCoverageMatrix();
  await writeCache(KEY, { data, at: data.at });
  return data;
}
