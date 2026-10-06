// Which wording of a step a lead gets, when the step has variants (A/B). Pure.
//
// A variant is a step with `variantOf` set to the id of the step it is another
// wording of. The choice is made from the lead's dedupKey alone, so the same
// lead gets the same wording on every run and a measurement does not get
// mixed up; dedupKey is unique per business across the whole database.
import { hashToUnit } from './stableHash.mjs';

// A wording without a weight of its own counts this much.
export const DEFAULT_WEIGHT = 50;

const weightOf = (s) => (typeof s.weight === 'number' && s.weight > 0 ? s.weight : s.weight === undefined || s.weight === null ? DEFAULT_WEIGHT : 0);

// The wordings a lead can get for a step: the step itself and its variants that
// are switched on. Empty when the step does not exist.
export function variantGroup(steps, parentId) {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const parent = list.find((s) => s.id === parentId && !s.variantOf);
  return parent ? [parent, ...list.filter((s) => s.variantOf === parentId && s.enabled)] : [];
}

// The wording this lead gets: the step itself or one of its variants, by their
// weights. null when the step does not exist. The id of what is returned is
// what goes into the lead's `sentStepIds` and into the `outreachsends` row, so
// a report can tell the wordings apart.
export function pickVariant(steps, parentId, dedupKey) {
  const group = variantGroup(steps, parentId);
  if (!group.length) return null;
  const total = group.reduce((n, s) => n + weightOf(s), 0);
  if (total <= 0) return group[0];
  const point = hashToUnit(String(dedupKey)) * total;
  let acc = 0;
  for (const s of group) { acc += weightOf(s); if (point < acc) return s; }
  return group[0];
}

// Below this many sends a wording has too little data to compare.
export const MIN_SAMPLE = 100;
export function enoughData(sent) {
  return (Number(sent) || 0) >= MIN_SAMPLE;
}
