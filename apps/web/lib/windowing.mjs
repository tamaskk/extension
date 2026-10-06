// Windowing for a long list with a few fixed row heights (the sidebar: folder
// rows and project rows). Only the rows near the viewport are rendered; padding
// above and below stands in for the rest, so the scrollbar behaves as if every
// row were there. Hand-written on purpose: the project takes no dependency for it.

// Start position of every row, and the height of the whole list.
export function rowOffsets(heights, gap) {
  const offsets = new Array(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) { offsets[i] = y; y += heights[i] + gap; }
  return { offsets, total: heights.length ? y - gap : 0 };
}

// Rows to render when the viewport shows [top, top + viewHeight) of the list.
// `last` is inclusive; an empty list gives last = -1.
export function visibleRange(layout, heights, top, viewHeight, overscan) {
  const { offsets, total } = layout;
  const n = offsets.length;
  if (!n) return { first: 0, last: -1, padTop: 0, padBottom: 0 };
  // first row whose bottom edge is below `top`
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid] + heights[mid] > top) hi = mid; else lo = mid + 1; }
  let first = lo;
  // last row whose top edge is above the bottom of the viewport
  const bottom = top + viewHeight;
  lo = first; hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] < bottom) lo = mid; else hi = mid - 1; }
  let last = lo;
  first = Math.max(0, first - overscan);
  last = Math.min(n - 1, last + overscan);
  return { first, last, padTop: offsets[first], padBottom: total - (offsets[last] + heights[last]) };
}
