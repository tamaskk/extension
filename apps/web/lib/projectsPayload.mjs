// Wire format of GET /api/projects.
//
// The plain list was 271 bytes per project (65 MB for 242k projects): thirteen
// key names repeated on every row, a `name` equal to `query` on 99.8% of them,
// a 24-character date, and a third of the rows all zeros. Rows are arrays here:
//
//   { v: 2, folders: [folderId…], rows: [[query, name, createdAt, folderIdx, …counters]] }
//
//   name        0 when it equals the query
//   createdAt   epoch ms when that reproduces the ISO string exactly, else the string
//   folderIdx   index into `folders`, -1 for no folder
//   counters    in COUNTERS order; left out entirely when all are zero

export const COUNTERS = ['total', 'noWebsite', 'hot', 'email', 'emailMiss', 'emailTodo', 'reviews', 'reviewsSum', 'ai', 'oppSum'];

function packDate(s) {
  if (typeof s !== 'string' || !s) return s || '';
  const ms = Date.parse(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === s ? ms : s;
}

export function encodeProjects(list) {
  const folders = [];
  const folderIdx = new Map();
  const rows = list.map((p) => {
    let fi = -1;
    if (p.folderId) {
      fi = folderIdx.get(p.folderId) ?? -1;
      if (fi < 0) { fi = folders.length; folders.push(p.folderId); folderIdx.set(p.folderId, fi); }
    }
    const row = [p.query, p.name === p.query ? 0 : p.name, packDate(p.createdAt), fi];
    if (COUNTERS.some((k) => p[k])) for (const k of COUNTERS) row.push(p[k] || 0);
    return row;
  });
  return { v: 2, folders, rows };
}

export function decodeProjects(payload) {
  if (Array.isArray(payload)) return payload; // the format before v2
  if (!payload || payload.v !== 2 || !Array.isArray(payload.rows)) throw new Error((payload && payload.error) || 'unexpected /api/projects payload');
  const folders = payload.folders || [];
  return payload.rows.map((r) => {
    const p = {
      query: r[0],
      name: r[1] === 0 ? r[0] : r[1],
      createdAt: typeof r[2] === 'number' ? new Date(r[2]).toISOString() : r[2],
      folderId: r[3] >= 0 ? folders[r[3]] : null,
    };
    for (let i = 0; i < COUNTERS.length; i++) p[COUNTERS[i]] = r.length > 4 ? r[4 + i] || 0 : 0;
    return p;
  });
}
