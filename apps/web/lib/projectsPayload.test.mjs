import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProjects, decodeProjects, COUNTERS } from './projectsPayload.mjs';

const zeros = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
const p = (over) => ({ query: 'plumbers near Austin city Texas', name: 'plumbers near Austin city Texas', createdAt: '2026-03-01T10:20:30.456Z', folderId: 'f_a', ...zeros, ...over });

test('round-trips every shape of project', () => {
  const list = [
    p({ total: 12, noWebsite: 3, hot: 2, email: 1, emailMiss: 4, emailTodo: 5, reviews: 6, reviewsSum: 70, ai: 8, oppSum: 512 }),
    p({ query: 'cafes near Graz Austria', name: 'Graz cafes (renamed)', folderId: 'f_b', total: 1 }),
    p({ query: 'no folder', name: 'no folder', folderId: null, total: 2 }),
    p({ query: 'empty project', name: 'empty project' }),               // all counters zero
    p({ query: 'odd date', name: 'odd date', createdAt: '2026-03-01' }), // not a full ISO stamp
    p({ query: 'no date', name: 'no date', createdAt: '' }),
  ];
  assert.deepEqual(decodeProjects(encodeProjects(list)), list);
});

test('survives a JSON round trip, as it travels over HTTP', () => {
  const list = [p({ total: 3 }), p({ query: 'b', name: 'B', folderId: null })];
  assert.deepEqual(decodeProjects(JSON.parse(JSON.stringify(encodeProjects(list)))), list);
});

test('is smaller than the plain list', () => {
  const list = Array.from({ length: 500 }, (_, i) => p({ query: `plumbers near Place ${i} Texas`, name: `plumbers near Place ${i} Texas`, total: i % 3 }));
  assert.ok(JSON.stringify(encodeProjects(list)).length < JSON.stringify(list).length * 0.5);
});

test('an empty list stays empty', () => {
  assert.deepEqual(decodeProjects(encodeProjects([])), []);
});

test('accepts the old plain-array payload (a browser may still hold one in its cache)', () => {
  const list = [p({ total: 3 })];
  assert.equal(decodeProjects(list), list);
});

test('throws on an error body instead of returning it as data', () => {
  assert.throws(() => decodeProjects({ error: 'projects failed' }), /projects failed/);
  assert.throws(() => decodeProjects(null));
});
