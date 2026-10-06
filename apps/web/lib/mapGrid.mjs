// What the map draws for the current view: every point on its own when there
// are few, otherwise one circle per screen cell with the count of its points.
//
// It replaced leaflet.markercluster: that built one marker object per lead and
// clustered them in chunks, which took tens of seconds for 200 000 points. Here
// the points stay in typed arrays and one pass over them places them for a view.

// Web Mercator on the unit square, the same projection Leaflet uses: multiply
// by 256 · 2^zoom to get pixels.
const MAX_LAT = 85.0511287798;
export function mercatorX(lng) { return (lng + 180) / 360; }
export function mercatorY(lat) {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

// Below this many points in view each is drawn as its own dot.
export const SINGLE_LIMIT = 400;
export const CELL_PX = 56;

/**
 * @param {{ xs: Float64Array, ys: Float64Array, flags: Uint8Array, scale: number, originX: number, originY: number, width: number, height: number, cell?: number, singleLimit?: number, forceSingle?: boolean }} view
 *   xs / ys are unit-square coordinates; `scale` is 256 · 2^zoom; the origin is the pixel position of the view's top-left corner.
 * @returns {{ x: number, y: number, count: number, noSite: number, index: number }[]}
 *   x / y in view pixels. `index` is the point when count is 1, otherwise -1.
 */
export function gridItems({ xs, ys, flags, scale, originX, originY, width, height, cell = CELL_PX, singleLimit = SINGLE_LIMIT, forceSingle = false }) {
  const cols = Math.ceil(width / cell) || 1;
  const rows = Math.ceil(height / cell) || 1;
  const count = new Uint32Array(cols * rows);
  const noSite = new Uint32Array(cols * rows);
  const sumX = new Float64Array(cols * rows);
  const sumY = new Float64Array(cols * rows);
  const last = new Int32Array(cols * rows);
  const inView = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] * scale - originX;
    if (x < 0 || x >= width) continue;
    const y = ys[i] * scale - originY;
    if (y < 0 || y >= height) continue;
    const c = Math.floor(y / cell) * cols + Math.floor(x / cell);
    count[c]++; noSite[c] += flags[i]; sumX[c] += x; sumY[c] += y; last[c] = i;
    if (forceSingle || inView.length <= singleLimit) inView.push(i);
  }
  // forceSingle is the deepest zoom, where leads at one address could never be told apart otherwise
  if (forceSingle || inView.length <= singleLimit) {
    return inView.map((i) => ({ x: xs[i] * scale - originX, y: ys[i] * scale - originY, count: 1, noSite: flags[i], index: i }));
  }
  const out = [];
  for (let c = 0; c < count.length; c++) {
    if (!count[c]) continue;
    out.push({ x: sumX[c] / count[c], y: sumY[c] / count[c], count: count[c], noSite: noSite[c], index: count[c] === 1 ? last[c] : -1 });
  }
  return out;
}

// The drawn item under a pointer, the nearest one within its radius.
export function itemAt(items, x, y, radiusOf) {
  let best = null; let bestD = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d <= radiusOf(it) + 3 && d < bestD) { best = it; bestD = d; }
  }
  return best;
}
