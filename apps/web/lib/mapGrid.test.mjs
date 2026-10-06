import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridItems, itemAt, mercatorX, mercatorY } from './mapGrid.mjs';

// a 200 × 100 view over points given directly in pixels (scale 1, origin 0)
const view = (points, extra = {}) => gridItems({
  xs: Float64Array.from(points.map((p) => p[0])), ys: Float64Array.from(points.map((p) => p[1])), flags: Uint8Array.from(points.map((p) => p[2] || 0)),
  scale: 1, originX: 0, originY: 0, width: 200, height: 100, cell: 50, singleLimit: 2, ...extra,
});

test('the projection puts Greenwich and the equator in the middle of the unit square', () => {
  assert.equal(mercatorX(0), 0.5);
  assert.ok(Math.abs(mercatorY(0) - 0.5) < 1e-12);
  assert.ok(mercatorY(47.5) < 0.5); // north is up
  assert.ok(Math.abs(mercatorY(90) - 0) < 1e-6); // the pole is clamped to the top edge
});

test('a few points in view are drawn one by one', () => {
  const items = view([[10, 10, 1], [12, 11, 0]]);

  assert.deepEqual(items, [{ x: 10, y: 10, count: 1, noSite: 1, index: 0 }, { x: 12, y: 11, count: 1, noSite: 0, index: 1 }]);
});

test('many points become one circle per cell, at the mean of its points', () => {
  const items = view([[10, 10, 1], [20, 30, 0], [30, 20, 1], [160, 80, 0]]);

  assert.deepEqual(items, [
    { x: 20, y: 20, count: 3, noSite: 2, index: -1 },
    { x: 160, y: 80, count: 1, noSite: 0, index: 3 },
  ]);
});

test('points outside the view are left out and do not count toward the limit', () => {
  const items = view([[10, 10], [500, 10], [10, -5], [199, 99]]);

  assert.deepEqual(items.map((i) => i.index), [0, 3]);
});

test('the deepest zoom draws every point on its own, however many share a cell', () => {
  const items = view([[10, 10], [10, 10], [11, 10], [12, 10]], { forceSingle: true });

  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.count === 1));
});

test('scale and origin move the points into view pixels', () => {
  const items = gridItems({ xs: Float64Array.of(0.5), ys: Float64Array.of(0.25), flags: Uint8Array.of(0), scale: 1000, originX: 400, originY: 200, width: 200, height: 100 });

  assert.deepEqual(items, [{ x: 100, y: 50, count: 1, noSite: 0, index: 0 }]);
});

test('itemAt picks the nearest drawn item under the pointer, or none', () => {
  const items = [{ x: 10, y: 10, count: 1 }, { x: 30, y: 10, count: 9 }];
  const radiusOf = (it) => (it.count > 1 ? 14 : 5);

  assert.equal(itemAt(items, 12, 10, radiusOf), items[0]);
  assert.equal(itemAt(items, 22, 10, radiusOf), items[1]);
  assert.equal(itemAt(items, 100, 60, radiusOf), null);
});
