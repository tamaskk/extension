import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateProjects, emptyAggregate, AGG_FIELDS } from './sidebarAggregate.mjs';

const p = (over) => ({ query: 'q', name: 'q', folderId: null, total: 0, noWebsite: 0, hot: 0, email: 0, emailMiss: 0, emailTodo: 0, reviews: 0, reviewsSum: 0, ai: 0, oppSum: 0, ...over });

test('an empty list gives empty aggregates', () => {
  const a = aggregateProjects([], new Set(['f1']));
  assert.deepEqual(a.all, emptyAggregate());
  assert.deepEqual(a.ungrouped, emptyAggregate());
  assert.deepEqual(a.folders, {});
});

test('sums every counter per folder, and counts projects and empty projects', () => {
  const a = aggregateProjects([
    p({ query: 'a', folderId: 'f1', total: 10, noWebsite: 4, hot: 3, email: 2, emailMiss: 1, emailTodo: 5, reviews: 2, reviewsSum: 40, ai: 1, oppSum: 300 }),
    p({ query: 'b', folderId: 'f1', total: 5, noWebsite: 1, oppSum: 50 }),
    p({ query: 'c', folderId: 'f1' }), // no leads
    p({ query: 'd', folderId: 'f2', total: 7 }),
  ], new Set(['f1', 'f2']));
  assert.deepEqual(a.folders.f1, { projects: 3, zero: 1, total: 15, noWebsite: 5, hot: 3, email: 2, emailMiss: 1, emailTodo: 5, reviews: 2, reviewsSum: 40, ai: 1, oppSum: 350 });
  assert.equal(a.folders.f2.total, 7);
  assert.equal(a.all.total, 22);
  assert.equal(a.all.projects, 4);
  assert.equal(a.ungrouped.projects, 0);
});

test('a project with no folder, or with a folder that no longer exists, is ungrouped', () => {
  const a = aggregateProjects([
    p({ query: 'a', folderId: null, total: 3 }),
    p({ query: 'b', folderId: '', total: 4 }),
    p({ query: 'c', folderId: 'deleted', total: 5 }),
    p({ query: 'd', folderId: 'f1', total: 6 }),
  ], new Set(['f1']));
  assert.equal(a.ungrouped.projects, 3);
  assert.equal(a.ungrouped.total, 12);
  assert.deepEqual(Object.keys(a.folders), ['f1']);
  assert.equal(a.all.total, 18);
});

test('the parts add up to the whole on every field', () => {
  const list = Array.from({ length: 200 }, (_, i) => p({ query: 'q' + i, folderId: i % 5 === 0 ? null : 'f' + (i % 3), total: i % 7, noWebsite: i % 2, hot: i % 3, email: i % 4, reviewsSum: i, oppSum: i * 3 }));
  const a = aggregateProjects(list, new Set(['f0', 'f1', 'f2']));
  for (const k of ['projects', 'zero', ...AGG_FIELDS]) {
    const parts = Object.values(a.folders).reduce((s, f) => s + f[k], 0) + a.ungrouped[k];
    assert.equal(parts, a.all[k], k);
  }
});
