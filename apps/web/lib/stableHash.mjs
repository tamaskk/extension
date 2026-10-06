// A number from a string that is the same on every run and every machine. Used
// wherever a lead must always land in the same bucket: which sender it gets,
// which wording of a step it gets.

// → a whole number from 0 to 4294967295. FNV-1a, then a mixing step so that
// keys which differ in one character land far apart.
export function hashToInt(text) {
  const s = String(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// → a number strictly between 0 and 1.
export function hashToUnit(text) {
  return (hashToInt(text) + 1) / 4294967297;
}
