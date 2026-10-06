// Per-folder sums of the project counters — what the sidebar badges and the
// stat tiles show. The browser used to compute these from the full project list
// (240k rows); the server now sends one small row per folder instead.
//
// `own` numbers cover the projects directly in a folder. The recursive totals
// (a folder plus its sub-folders) are added up by the client over the 774-node tree.

export const AGG_FIELDS = ['total', 'noWebsite', 'hot', 'email', 'emailMiss', 'emailTodo', 'reviews', 'reviewsSum', 'ai', 'oppSum'];

export function emptyAggregate() {
  const a = { projects: 0, zero: 0 }; // zero = projects without a single lead
  for (const k of AGG_FIELDS) a[k] = 0;
  return a;
}

function add(a, p) {
  a.projects++;
  if (!p.total) a.zero++;
  for (const k of AGG_FIELDS) a[k] += p[k] || 0;
}

// `existing` = ids of the folders that exist. A project whose folderId is empty
// or points at a deleted folder counts as ungrouped, like in the sidebar.
export function aggregateProjects(projects, existing) {
  const folders = {};
  const ungrouped = emptyAggregate();
  const all = emptyAggregate();
  for (const p of projects) {
    add(all, p);
    if (p.folderId && existing.has(p.folderId)) add(folders[p.folderId] || (folders[p.folderId] = emptyAggregate()), p);
    else add(ungrouped, p);
  }
  return { folders, ungrouped, all };
}
