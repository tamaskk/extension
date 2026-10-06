import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowOffsets, visibleRange } from './windowing.mjs';

// what the DOM ends up with: top padding + rendered rows with gaps + bottom padding
const rendered = (heights, gap, r) => {
  let h = 0;
  for (let i = r.first; i <= r.last; i++) h += heights[i] + (i > r.first ? gap : 0);
  return r.padTop + h + r.padBottom;
};

test('offsets include the gap between rows, not after the last one', () => {
  const { offsets, total } = rowOffsets([34, 33, 33], 4);
  assert.deepEqual(offsets, [0, 38, 75]);
  assert.equal(total, 108);
  assert.deepEqual(rowOffsets([], 4), { offsets: [], total: 0 });
});

test('an empty list renders nothing', () => {
  const lay = rowOffsets([], 4);
  assert.deepEqual(visibleRange(lay, [], 0, 500, 5), { first: 0, last: -1, padTop: 0, padBottom: 0 });
});

test('a list shorter than the viewport renders whole', () => {
  const h = [34, 33, 33]; const lay = rowOffsets(h, 4);
  const r = visibleRange(lay, h, 0, 900, 0);
  assert.deepEqual([r.first, r.last, r.padTop, r.padBottom], [0, 2, 0, 0]);
});

test('the total height never changes, wherever the window is', () => {
  const h = Array.from({ length: 5000 }, (_, i) => (i % 7 === 0 ? 34 : 33));
  const lay = rowOffsets(h, 4);
  for (const top of [-400, 0, 1, 37, 38, 5000, 91234.5, lay.total - 300, lay.total, lay.total + 5000]) {
    for (const overscan of [0, 20]) {
      const r = visibleRange(lay, h, top, 988, overscan);
      assert.equal(rendered(h, 4, r), lay.total, `top ${top} overscan ${overscan}`);
      assert.ok(r.last - r.first < 80, 'only a screenful of rows is rendered');
    }
  }
});

test('every row that intersects the viewport is rendered', () => {
  const h = Array.from({ length: 300 }, () => 33); const lay = rowOffsets(h, 4);
  const r = visibleRange(lay, h, 370, 100, 0); // rows are 37px apart: row 10 starts at 370, row 12 at 444
  assert.equal(r.first, 10);
  assert.equal(r.last, 12);
  const up = visibleRange(lay, h, 369, 100, 0); // one pixel up: row 9 (333..366) is hidden, its gap shows
  assert.equal(up.first, 10);
  const up2 = visibleRange(lay, h, 365, 100, 0); // row 9 ends at 366 → visible
  assert.equal(up2.first, 9);
});

test('overscan widens the window but stays inside the list', () => {
  const h = Array.from({ length: 100 }, () => 33); const lay = rowOffsets(h, 4);
  const r = visibleRange(lay, h, 0, 100, 20);
  assert.equal(r.first, 0);
  assert.equal(r.last, 22);
  const end = visibleRange(lay, h, lay.total - 50, 100, 20);
  assert.equal(end.last, 99);
});
