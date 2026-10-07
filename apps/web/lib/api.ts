'use client';

import type { FolderAggregate, LeadRow, OutreachSenderRow, OutreachSequenceRow, OutreachStep, ProjectSummary, SidebarPayload } from './types';
import { decodeProjects } from './projectsPayload.mjs';

async function jget(url: string) { const r = await fetch(url); return r.json(); }
// 'force-cache' answers from the browser's HTTP cache without touching the
// network (and falls back to the network when nothing is stored); 'no-cache'
// revalidates with the stored ETag. The ETag tells the caller whether the two
// answers are the same content.
async function jgetEtag(url: string, cache: RequestCache) {
  const r = await fetch(url, { cache });
  return { data: await r.json(), etag: r.headers.get('etag') || '' };
}
async function jsend(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export interface ProjectSearch { search?: string; ptypes?: string[]; pregions?: string[]; country?: string }
function projectSearchParams(q: ProjectSearch): URLSearchParams {
  const p = new URLSearchParams();
  p.set('search', q.search || ''); // always present: it is what selects the search branch of the route
  (q.ptypes || []).forEach((t) => p.append('ptype', t));
  (q.pregions || []).forEach((r) => p.append('pregion', r));
  if (q.country) p.set('country', q.country);
  return p;
}

export interface LeadsQuery {
  project?: string | null;
  folder?: string | null;
  group?: string | null;
  filter?: string;
  search?: string;
  categories?: string[];
  ptypes?: string[];
  pregions?: string[];
  country?: string;
  email?: string;  // '' | has | none | todo | checked | failed
  phone?: string;  // '' | has | none
  sort?: string;
  dir?: number;
  page?: number;
  pageSize?: number;
}

export interface DupeGroup { name: string; address?: string; items: { project: string; key: string; name: string; category?: string; rating?: number; reviewCount?: number; checked?: boolean }[]; }

export interface ReviewListRow {
  id: string; dedupKey: string; businessName: string; address: string; project: string;
  author: string; authorUrl: string; rating: number | null; text: string;
  relativeTime: string; ownerResponse: string; scrapedAt: string;
}

// one Changelog event (see lib/activity.ts)
export interface ActivityRow { id: string; at: string; type: string; title: string; project?: string; keys?: string[]; n?: number; source?: string; data?: Record<string, unknown>; }

// What the sequence editor sends. A step without an id is new and gets one on the server.
export type SequenceInput = Partial<Pick<OutreachSequenceRow, 'name' | 'language' | 'senderIds' | 'stopOnReply' | 'stopOnBounce' | 'enabled' | 'autoFollowUp'>>
  & { steps?: (Omit<OutreachStep, 'id'> & { id?: string })[] };
// `errors` lists what keeps the sequence from running; a save that was refused carries them too
export interface SequenceSaved { ok: boolean; error?: string; errors?: string[]; sequenceId?: string }
export interface SequencePreview {
  ok: boolean; error?: string;
  lead?: { project: string; dedupKey: string; name: string; email: string; category: string; address: string; website: string };
  // `missing` and `unknown` name the variables that left a hole in this step for this lead
  steps?: { id: string; day: number | null; sameThread: boolean; subject: string; body: string; missing: string[]; unknown: string[] }[];
}
// What saving an edit would do (POST .../check). Nothing is written by it.
export interface SequenceCheck {
  ok: boolean; error?: string;
  leadsKnown?: boolean;  // false = the active leads could not be read, the numbers are not real
  capped?: boolean;
  activeLeads?: number;
  impact?: { kind: string; stepId: string; text: string }[];
  variables?: { name: string; known: boolean; stepIds: string[]; missing: number; of: number }[];
  errors?: string[];
}

// One call of the two-step enrolment (POST /api/outreach/enroll). With `dryRun`
// nothing is written. A real run is repeated with the `cursor`, `runId` and
// `taken` of the previous answer until `done`.
export interface EnrollCall {
  action: 'enroll' | 'unenroll' | 'continue'; dryRun: boolean; sequenceId: string; limit: number; ignoreLanguage: boolean;
  source: { kind: 'filter'; query: LeadsQuery } | { kind: 'checked' } | { kind: 'group'; groupId: string } | { kind: 'keys'; keys: string[] };
  cursor?: string; runId?: string; taken?: number;
}
export interface SuggestedLead { project: string; key: string; name: string; to: string; sender: string; category: string; score: number | null }
export interface EnrollResult {
  ok: boolean; error?: string; dryRun?: boolean;
  matched?: number; examined?: number; complete?: boolean; wouldTake?: number;
  enrolled?: number; taken?: number; done?: boolean; cursor?: string; runId?: string;
  skipped?: Record<string, number>;
  byLanguage?: Record<string, number>;
  bySender?: { senderId: string; label: string; n: number }[];
  samples?: { name: string; to: string; project: string; sender: string }[];
}

// What the sender form sends. `password` is the app password: empty on an edit means "keep the stored one".
export interface SenderInput {
  label: string; fromName: string; fromEmail: string; language: string; authUser: string; password: string;
  smtpHost: string; smtpPort: string; imapHost: string; imapPort: string; notes: string;
  dailyLimit: number;
  warmup: { enabled: boolean; tiers: { fromDay: number; dailyLimit: number }[] };
  sendDays: number[]; windowFrom: number; windowTo: number; // on the recipient's clock
}
export interface SenderTest { ok: boolean; error?: string; works?: boolean; smtp?: { ok: boolean; message: string }; imap?: { ok: boolean; message: string } }

// the answer of POST /api/outreach/tick: what the round did and when to ask again
export interface RunnerTick {
  ok: boolean; error?: string; action?: string; reason?: string; sentToday?: number; nextInMs?: number; nextAt?: string;
  sent?: number; skipped?: number; remaining?: number;
  blocked?: boolean; blockers?: string[]; // nothing may be sent at all right now: not a failure of the loop
}
// one row of the report: counts, and rates that are null while fewer than `minSample` emails went out
export interface ReportRow {
  id: string; label: string; sequence?: string; variant?: boolean;
  sent: number; bounced: number; soft: number; blocked: number; replied: number; stopped: number; unknown: number; assumedDelivered: number;
  enough: boolean; rates: { bounce: number | null; block: number | null; reply: number | null; stop: number | null }; levels: { bounce: string; block: string };
}
// GET /api/coverage: `present[typeKey][rowIndex]` is how many of the row's places have a project
export interface CoverageRow { country: string; kind: 'cities' | 'state' | 'city'; region: string; total: number }
export interface CoverageMatrixData {
  ok: boolean; error?: string;
  rows?: CoverageRow[];
  types?: { key: string; label: string; projects: number }[];
  present?: Record<string, Record<number, number>>;
  at?: number;
}
export interface OutreachReportData {
  ok: boolean; error?: string; days?: number;
  total?: Omit<ReportRow, 'id' | 'label'>; bySender?: ReportRow[]; byStep?: ReportRow[]; byOffer?: ReportRow[];
  seeds?: number; thresholds?: { bounce: number; block: number }; minSample?: number;
  postmaster?: { spamRate: number | null; date: string; days: number | null; stale: boolean };
}
// the state of the day (GET /api/outreach/control): the gate, the senders, the loop, the hand-entered values
export interface ControlState {
  ok: boolean; error?: string;
  gate?: { allowed: boolean; blockers: string[]; warnings: string[]; capToday: number };
  senders?: { senderId: string; label: string; fromEmail: string; language: string; capToday: number; capTomorrow: number; sentToday: number; steppedBack: boolean; idleDays: number | null; warmup: string }[];
  rates?: { sent: number; bounced: number; blocked: number; bounce: number | null; block: number | null };
  settings?: { postmaster: { spamRate: number | null; date: string }; seed: { date: string; inbox: number | null; of: number | null }; seedAddresses: string[]; authConfirmedAt: string; repliesReviewedAt: string };
  unseenReplies?: number;
  heartbeat?: { lastTickAt: string; action: string; reason: string; sentToday: number; stale: boolean };
}
// GET /api/outreach/today. `fate`: today = goes out today · hours = today, once it is a sending hour where the lead is ·
// next = after midnight in Budapest, on tomorrow's limit ·
// limit = the sender's limit is used up before its turn · closed = no sending hour left today · off = its sequence is switched off
export interface TodayQueueRow {
  project: string; dedupKey: string; name: string; to: string; sequenceId: string; sequence: string; step: number; steps: number;
  senderId: string; dueAt: string; tz: string; fate: 'today' | 'hours' | 'next' | 'limit' | 'closed' | 'off'; opensAt: string;
  expectedAt: string; // when it is likely to go out, counting the sender's pause between two emails; '' when not today
}
export interface TodayPlanData {
  ok: boolean; error?: string;
  gate?: { allowed: boolean; blockers: string[]; warnings: string[]; capToday: number };
  heartbeat?: { lastTickAt: string; action: string; reason: string; sentToday: number; stale: boolean };
  senders?: { senderId: string; label: string; fromEmail: string; capToday: number; sentToday: number; left: number; queued: number; more: boolean }[];
  sequences?: { sequenceId: string; name: string; language: string; enabled: boolean; steps: number }[];
  queue?: TodayQueueRow[];
  sent?: { to: string; sentAt: string; outcome: string; sequence: string; step: number; senderId: string; seed: boolean }[];
  at?: string;
}
// GET /api/outreach/mail: one email that went out (`out`) or came in (`in`).
// `state` is the outcome of a sent email, or what an arrived one is: human | auto | bounce | stop.
// `note` is the start of an arrived message's text, or the receiving server's words for a bounced send.
export interface MailLogRow {
  dir: 'out' | 'in'; at: string; senderId: string; address: string; title: string; state: string; note: string;
  sequenceId: string; project: string; dedupKey: string; leadName?: string; ignored?: string;
}
export interface MailLogData { ok: boolean; error?: string; senders?: { senderId: string; label: string; fromEmail: string }[]; rows?: MailLogRow[]; capped?: boolean }
export interface ControlPatch { postmaster?: { spamRate: string; date: string }; seed?: { inbox: number; of: number; date?: string }; seedAddresses?: string[]; authConfirmed?: boolean; repliesReviewed?: true }

// what one round of the mailbox watcher found (POST /api/outreach/inbox)
export interface InboxRoundResult { ok: boolean; error?: string; checked?: string; messages?: number; bounces?: number; replies?: number; stops?: number; autoReplies?: number; unmatched?: number; more?: boolean; reason?: string }
// one message that arrived in a sender mailbox, for the Replies view
export interface InboxItem {
  id: string; senderId: string; kind: 'human' | 'bounce' | 'auto'; from: string; subject: string; at: string; text: string;
  stop: boolean; bounceKind: string; bounceStatus: string;
  project: string; dedupKey: string; leadName: string; sequenceId: string; stepId: string; matchedBy: string; seenAt: string;
  ignored: string; // why the message was stored without any effect; '' = it was acted on
}
// one entry of the suppression list: an address, or a whole company domain (then `email` is "@domain")
export interface SuppressionRow { email: string; domain: string; reason: string; source: string; note: string; createdAt: string }
// an email a dead round left behind: it may have gone out (GET /api/outreach/unknown)
export interface UnknownSendRow { id: string; project: string; dedupKey: string; name: string; to: string; sentAt: string; sequenceId: string; stepId: string; senderId: string }

export interface OrganizeMove { query: string; from: string; createdAt: string; }
export interface OrganizeSub { name: string; status: 'created' | 'reparented' | 'existing'; fromParent?: string; movedCount: number; alreadyHere: number; moved: OrganizeMove[]; }
export interface OrganizeRoot { name: string; icon: string; created: boolean; movedCount: number; subs: OrganizeSub[]; }

// one map marker: [lat, lng, noSite (1 = no real website), dedupKey] — see /api/geo
export type GeoPoint = [number, number, 0 | 1, string];

// the scope and filter part of a lead query (everything except sort and paging)
function leadsParams(q: LeadsQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.project) p.set('project', q.project);
  if (q.folder) p.set('folder', q.folder);
  if (q.group) p.set('group', q.group);
  if (q.filter) p.set('filter', q.filter);
  if (q.search) p.set('search', q.search);
  (q.categories || []).forEach((c) => p.append('cat', c));
  (q.ptypes || []).forEach((t) => p.append('ptype', t));
  (q.pregions || []).forEach((r) => p.append('pregion', r));
  if (q.country) p.set('country', q.country);
  if (q.email) p.set('email', q.email);
  if (q.phone) p.set('phone', q.phone);
  return p;
}

export const api = {
  // The sidebar without the project list: folders, per-folder sums, filter options.
  // 'force-cache' shows the browser's copy at once, 'no-cache' revalidates (see lib/store.ts hydrate).
  getSidebarFrom: async (cache: RequestCache): Promise<{ data: SidebarPayload; etag: string }> => {
    const r = await jgetEtag('/api/sidebar', cache);
    if (!r.data?.ok) throw new Error(r.data?.error || 'sidebar failed');
    return { data: r.data as SidebarPayload, etag: r.etag };
  },
  // the projects directly in one folder (ROOT_FOLDER: the ones in no folder)
  getFolderProjects: async (folderId: string): Promise<ProjectSummary[]> =>
    decodeProjects(await jget('/api/projects?folder=' + encodeURIComponent(folderId))),
  // [query, name] of every project under a folder, sub-folders included (name 0 = same as the query)
  getFolderProjectNames: async (folderId: string): Promise<[string, string | 0][]> => {
    const r = await jget('/api/projects?deep=1&fields=names&folder=' + encodeURIComponent(folderId));
    if (!r?.ok) throw new Error(r?.error || 'names failed');
    return r.names;
  },
  // the projects that pass the sidebar filters, wherever they are (first `limit` rows; `total` counts all)
  searchProjects: async (q: ProjectSearch): Promise<{ rows: ProjectSummary[]; total: number }> => {
    const r = await jget('/api/projects?' + projectSearchParams(q).toString());
    return { rows: decodeProjects(r), total: r.total || 0 };
  },
  // only their queries, up to 5,000 — for "select all filtered"
  searchProjectQueries: async (q: ProjectSearch): Promise<{ queries: string[]; total: number }> => {
    const p = projectSearchParams(q); p.set('fields', 'query');
    const r = await jget('/api/projects?' + p.toString());
    if (!r?.ok) throw new Error(r?.error || 'search failed');
    return { queries: r.queries || [], total: r.total || 0 };
  },
  // the stat tiles for a scope, from the per-project counters
  getScopeStats: async (q: { project?: string | null; folder?: string | null } & ProjectSearch): Promise<FolderAggregate> => {
    const p = projectSearchParams({ ...q, search: '' });
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    const r = await jget('/api/sidebar/stats?' + p.toString());
    if (!r?.ok) throw new Error(r?.error || 'stats failed');
    return r.stats;
  },
  getGroups: () => jget('/api/groups') as Promise<{ ok: boolean; groups: { groupId: string; name: string; createdAt: string; count: number }[] }>,
  getGroupLeads: (id: string, page = 1, pageSize = 100) =>
    jget(`/api/groups?id=${encodeURIComponent(id)}&page=${page}&pageSize=${pageSize}`) as Promise<{ ok: boolean; name?: string; rows: any[]; total: number; error?: string }>,
  createGroup: (name: string, opts: { keys?: string[]; fromChecked?: boolean } = {}) =>
    jsend('/api/groups', 'POST', { name, ...opts }) as Promise<{ ok: boolean; groupId?: string; count?: number; error?: string }>,
  renameGroup: (id: string, name: string) => jsend('/api/groups', 'PATCH', { id, name }),
  addToGroup: (id: string, opts: { keys?: string[]; fromChecked?: boolean }) =>
    jsend('/api/groups', 'PATCH', { id, add: opts.keys || [], fromChecked: !!opts.fromChecked }) as Promise<{ ok: boolean; added?: number; error?: string }>,
  removeFromGroup: (id: string, keys: string[]) => jsend('/api/groups', 'PATCH', { id, remove: keys }),
  deleteGroup: (id: string) => jsend('/api/groups', 'DELETE', { id }),
  getLeadSearchQueue: (scope: { project?: string | null; folder?: string | null; retry?: boolean }) => {
    const p = new URLSearchParams();
    if (scope.project) p.set('project', scope.project);
    if (scope.folder) p.set('folder', scope.folder);
    if (scope.retry) p.set('retry', '1');
    return jget('/api/lead-search?' + p.toString()) as Promise<{ ok: boolean; rows: { project: string; dedupKey: string; name: string; address: string; phone: string; category: string; websiteStatus: string }[]; capped?: boolean; error?: string }>;
  },
  leadSearchOne: (project: string, dedupKey: string) =>
    jsend('/api/lead-search', 'POST', { project, dedupKey }) as Promise<{ ok: boolean; found?: boolean; skipped?: boolean; email?: string; owner?: string; source?: string; error?: string }>,
  getVapiQueue: (group: string) =>
    jget(`/api/vapi?group=${encodeURIComponent(group)}`) as Promise<{ ok: boolean; name?: string; rows: { project: string; dedupKey: string; name: string; phone: string; address: string; e164: string | null }[]; envError?: string | null; error?: string }>,
  vapiCall: (b: { phone: string; name?: string; address?: string; dedupKey?: string }) =>
    jsend('/api/vapi', 'POST', b) as Promise<{ ok: boolean; callId?: string; status?: string; error?: string }>,
  logCall: (project: string, dedupKey: string, call: { id: string; at: string; endedReason?: string }) =>
    jsend('/api/leads', 'PATCH', { project, dedupKey, addCall: call }),
  vapiStatus: (id: string) =>
    jget(`/api/vapi?id=${encodeURIComponent(id)}`) as Promise<{ ok: boolean; status?: string; endedReason?: string; recordingUrl?: string; transcript?: string; summary?: string; error?: string }>,
  generateEmail: (project: string, dedupKey: string, context: Record<string, unknown>) =>
    jsend('/api/email', 'POST', { project, dedupKey, context }) as Promise<{ ok: boolean; subject?: string; body?: string; emailAt?: string; error?: string }>,
  generateSms: (project: string, dedupKey: string, context: Record<string, unknown>) =>
    jsend('/api/email', 'POST', { project, dedupKey, context, kind: 'sms' }) as Promise<{ ok: boolean; body?: string; smsAt?: string; error?: string }>,
  sendEmail: (project: string, dedupKey: string) =>
    jsend('/api/send-email', 'POST', { project, dedupKey }) as Promise<{ ok: boolean; to?: string; emailSentAt?: string; error?: string }>,
  getNotes: (q: { search?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.search) p.set('search', q.search);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    return jget('/api/notes?' + p.toString()) as Promise<{ ok: boolean; rows: LeadRow[]; total: number; error?: string }>;
  },
  getActivity: (q: { groups?: string; q?: string; project?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.groups) p.set('groups', q.groups);
    if (q.q) p.set('q', q.q);
    if (q.project) p.set('project', q.project);
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    return jget('/api/activity?' + p.toString()) as Promise<{ ok: boolean; rows: ActivityRow[]; total: number; summary?: Record<string, { events: number; n: number }>; error?: string }>;
  },
  getCategorySummary: () =>
    jget('/api/categories/summary') as Promise<{ ok: boolean; rows: { category: string; count: number; projects: number }[]; at: number; stale: boolean; error?: string }>,
  refreshCategorySummary: (body: { after?: string | null; at?: number } = {}) =>
    jsend('/api/categories/summary', 'POST', body) as Promise<{ ok: boolean; done?: boolean; after?: string | null; at?: number; categories?: number; error?: string }>,
  refreshProjectStats: (body: { after?: string | null; at?: string } = {}) =>
    jsend('/api/projects/refresh', 'POST', body) as Promise<{ ok: boolean; done?: boolean; after?: string | null; at?: string; projects?: number; error?: string }>,

  // `total: false` skips the server-side count (total comes back as -1): the
  // dashboard fetches it apart with getLeadsTotal, so rows never wait for it.
  getLeads: (q: LeadsQuery, opts: { total?: boolean } = {}): Promise<{ rows: LeadRow[]; total: number }> => {
    const p = leadsParams(q);
    if (q.sort) p.set('sort', q.sort);
    if (q.dir) p.set('dir', String(q.dir));
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    if (opts.total === false) p.set('total', '0');
    return jget('/api/leads?' + p.toString());
  },
  // how many leads match — no sort or paging, those do not change the count
  getLeadsTotal: (q: LeadsQuery): Promise<{ total: number; error?: string }> => {
    const p = leadsParams(q);
    p.set('only', 'total');
    return jget('/api/leads?' + p.toString());
  },

  // live counts for the email tile: leads with an email / searched without finding one
  getEmailCounts: (q: Pick<LeadsQuery, 'project' | 'folder' | 'ptypes' | 'pregions' | 'country'>): Promise<{ ok: boolean; email: number; miss: number; error?: string }> => {
    const p = new URLSearchParams({ emailCounts: '1' });
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    (q.ptypes || []).forEach((t) => p.append('ptype', t));
    (q.pregions || []).forEach((r) => p.append('pregion', r));
    if (q.country) p.set('country', q.country);
    return jget('/api/leads?' + p.toString());
  },

  // one lead by its dedupKey (the map popup)
  getLeadByKey: (key: string): Promise<{ rows: LeadRow[]; total: number }> => jget('/api/leads?key=' + encodeURIComponent(key)),
  // the last finished duplicate scan (at = 0: never scanned)
  getDuplicates: (): Promise<{ ok: boolean; groups: DupeGroup[]; total: number; at: number; error?: string }> => jget('/api/duplicates'),
  // one slice of a new scan; loop with the returned `after` until done
  scanDuplicates: (body: { after?: string | null; at?: number } = {}): Promise<{ ok: boolean; done?: boolean; after?: string | null; at?: number; total?: number; error?: string }> =>
    jsend('/api/duplicates', 'POST', body),
  getCategories: (q: { project?: string | null; folder?: string | null }): Promise<{ categories: { category: string; count: number }[] }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    return jget('/api/categories?' + p.toString());
  },
  getGeo: (q: { project?: string | null; folder?: string | null; filter?: string; search?: string; categories?: string[]; ptypes?: string[]; pregions?: string[]; country?: string }): Promise<{ points: GeoPoint[]; total: number; capped: boolean }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.filter) p.set('filter', q.filter);
    if (q.search) p.set('search', q.search);
    (q.categories || []).forEach((c) => p.append('cat', c));
    (q.ptypes || []).forEach((t) => p.append('ptype', t));
    (q.pregions || []).forEach((r) => p.append('pregion', r));
    if (q.country) p.set('country', q.country);
    return jget('/api/geo?' + p.toString());
  },
  getStats: (q: { project?: string | null; folder?: string | null; granularity?: 'day' | 'hour' }): Promise<{ buckets: { key: string; count: number }[]; gran: string; total: number; metrics?: { total: number; noWebsite: number; hot: number; email: number; reviews: number; reviewsSum: number; ai: number; avgOpp: number } }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    if (q.granularity) p.set('granularity', q.granularity);
    return jget('/api/stats?' + p.toString());
  },
  getProjectFacets: (q: { project?: string | null; folder?: string | null }): Promise<{ types: { value: string; count: number }[]; regions: { value: string; count: number }[] }> => {
    const p = new URLSearchParams();
    if (q.project) p.set('project', q.project);
    if (q.folder) p.set('folder', q.folder);
    return jget('/api/projectfacets?' + p.toString());
  },
  // a failed export must not be downloaded as if it were the bundle
  exportBundle: async (opts: { queries?: string[]; folderId?: string }) => {
    const r = await jsend('/api/export', 'POST', opts);
    if (r?.ok === false) throw new Error(r.error || 'export failed');
    return r;
  },

  createFolder: (id: string, name: string, createdAt: string, parentId: string | null = null) => jsend('/api/folders', 'POST', { id, name, createdAt, parentId }),
  renameFolder: (id: string, name: string) => jsend('/api/folders', 'PATCH', { id, name }),
  setFolderCollapsed: (id: string, collapsed: boolean) => jsend('/api/folders', 'PATCH', { id, collapsed }),
  moveFolder: (id: string, parentId: string | null) => jsend('/api/folders', 'PATCH', { id, parentId }),
  moveFolders: (ids: string[], parentId: string | null) => jsend('/api/folders', 'PATCH', { ids, parentId }),
  setFolderIcon: (id: string, icon: string) => jsend('/api/folders', 'PATCH', { id, icon }),
  setFoldersIcon: (ids: string[], icon: string) => jsend('/api/folders', 'PATCH', { ids, icon }),
  deleteFolder: (id: string) => jsend('/api/folders', 'DELETE', { id }),
  reorderFolders: (ids: string[]) => jsend('/api/folders', 'PATCH', { order: ids }),

  renameProject: (query: string, name: string) => jsend('/api/projects', 'PATCH', { query, name }),
  renameProjects: (queries: string[], name: string) => jsend('/api/projects', 'PATCH', { queries, name }),
  moveProjects: (queries: string[], folderId: string | null) => jsend('/api/projects', 'PATCH', { queries, folderId }),
  deleteProjects: (queries: string[]) => jsend('/api/projects', 'DELETE', { queries }),

  setChecked: (project: string, dedupKey: string, checked: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, checked }),
  setCall: (project: string, dedupKey: string, call: boolean) => jsend('/api/leads', 'PATCH', { project, dedupKey, call }),
  getCallCount: (): Promise<{ total: number }> => jget('/api/calls?count=1'),
  getCheckedCount: (): Promise<{ total: number }> => jget('/api/leads?countChecked=1'),
  uncheckAll: (): Promise<{ ok: boolean; updated: number }> => jsend('/api/leads', 'PATCH', { uncheckAll: true }),
  getCalls: (): Promise<{ rows: LeadRow[]; total: number; capped?: boolean }> => jget('/api/calls'),
  setWebsiteStatus: (project: string, dedupKey: string, websiteStatus: string) => jsend('/api/leads', 'PATCH', { project, dedupKey, websiteStatus }),
  setOpportunity: (project: string, dedupKey: string, opportunityScore: number) => jsend('/api/leads', 'PATCH', { project, dedupKey, opportunityScore }),
  updateLeadField: (project: string, dedupKey: string, field: string, value: unknown) => jsend('/api/leads', 'PATCH', { project, dedupKey, field, value }),
  setTags: (project: string, dedupKey: string, tags: string[]) => jsend('/api/leads', 'PATCH', { project, dedupKey, tags }),
  deleteRecords: (items: { query: string; key: string }[]) => jsend('/api/leads', 'DELETE', { items }),
  deleteAllChecked: (): Promise<{ ok: boolean; deleted?: number }> => jsend('/api/leads', 'DELETE', { allChecked: true }),

  getReviews: (dedupKey: string): Promise<{ ok: boolean; total: number; rows: import('./types').ReviewRow[] }> =>
    jget('/api/reviews?dedupKey=' + encodeURIComponent(dedupKey)),

  // Reviews view — paginated list with geo/business filters
  getReviewList: (q: { page?: number; pageSize?: number; dedupKey?: string; country?: string; state?: string; city?: string; search?: string }): Promise<{ ok: boolean; rows: ReviewListRow[]; total: number; page: number; pageSize: number }> => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    if (q.dedupKey) p.set('dedupKey', q.dedupKey);
    if (q.country) p.set('country', q.country);
    if (q.state) p.set('state', q.state);
    if (q.city) p.set('city', q.city);
    if (q.search) p.set('search', q.search);
    return jget('/api/reviews/list?' + p.toString());
  },
  getReviewBusinesses: (q: string): Promise<{ ok: boolean; businesses: { dedupKey: string; name: string; address: string; reviewsCount: number }[] }> =>
    jget('/api/reviews/businesses?q=' + encodeURIComponent(q)),

  // AI insights for one lead via the local Claude CLI (localhost only — see /api/enrich)
  enrichLead: (dedupKey: string): Promise<{ ok: boolean; error?: string; ai?: { aiSummary: string; aiPainPoints: string; aiAdvantages: string; aiPitch: string; aiAt: string } }> =>
    jsend('/api/enrich', 'POST', { dedupKey }),

  getTags: (): Promise<{ tags: { name: string; color: string }[] }> => jget('/api/tags'),
  createTag: (name: string, color: string) => jsend('/api/tags', 'POST', { name, color }),
  deleteTag: (name: string) => jsend('/api/tags', 'DELETE', { name }),

  sync: (bundle: unknown) => jsend('/api/sync', 'POST', bundle),

  // one chunk of the search-token backfill; loop with lastId until done (see docs/PERFORMANCE_PLAN.md, task 14)
  backfillSearchTokens: (after: string | null): Promise<{ ok: boolean; processed: number; lastId: string | null; done: boolean; error?: string }> =>
    jsend('/api/search-backfill', 'POST', { after }),

  recalcScores: (after: string | null): Promise<{ ok: boolean; processed: number; lastId: string | null; done: boolean; total?: number }> =>
    jsend('/api/recalc', 'POST', { after }),

  // Auto-organize: re-file projects into "<region> <vertical>" folders nested
  // under "<country> <vertical>" roots. Pass { dryRun:true } for a preview.
  organize: (opts: { dryRun?: boolean; cleanup?: boolean } = {}): Promise<{
    ok: boolean; dryRun: boolean; totalProjects: number; foldersCreated: string[];
    foldersReparented: number; projectsMoved: number; foldersDeleted: string[];
    unmatched: number; sampleUnmatched: string[]; error?: string;
    plan: { roots: OrganizeRoot[] };
  }> => jsend('/api/organize', 'POST', opts),

  // Chunked sync — splits big bundles so no request exceeds the serverless body
  // limit (Vercel ~4.5MB). Returns aggregate counts.
  syncBundleChunked: async (
    bundle: { folders?: Record<string, unknown>; projects?: Record<string, { query: string; name?: string; createdAt?: string; folderId?: string | null; records?: Record<string, unknown> }> },
    onProgress?: (done: number, total: number) => void,
    chunkSize = 500,
  ) => {
    const folders = bundle.folders || {};
    const projects = Object.values(bundle.projects || {});
    let sentFolders = false, projCount = 0, added = 0, updated = 0, skippedDuplicates = 0;
    if (Object.keys(folders).length) { await jsend('/api/sync', 'POST', { gridleads: 1, folders, projects: {} }); sentFolders = true; }
    for (const p of projects) {
      const meta = { query: p.query, name: p.name, createdAt: p.createdAt, folderId: p.folderId };
      const entries = Object.entries(p.records || {});
      if (!entries.length) {
        await jsend('/api/sync', 'POST', { gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: {} } } });
        sentFolders = true;
      } else {
        for (let i = 0; i < entries.length; i += chunkSize) {
          const chunk = Object.fromEntries(entries.slice(i, i + chunkSize));
          const j = await jsend('/api/sync', 'POST', { gridleads: 1, folders: sentFolders ? {} : folders, projects: { [p.query]: { ...meta, records: chunk } } });
          sentFolders = true;
          if (j) { added += j.added || 0; updated += j.updated || 0; skippedDuplicates += j.skippedDuplicates || 0; }
        }
      }
      projCount++;
      if (onProgress) onProgress(projCount, projects.length);
    }
    return { ok: true, projects: projCount, added, updated, skippedDuplicates };
  },
  // One round of the outreach loop (components/OutreachRunner.tsx). A request that
  // hangs is aborted, otherwise the loop would wait on it forever.
  outreachTick: async (timeoutMs: number): Promise<RunnerTick> => {
    const r = await fetch('/api/outreach/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(timeoutMs) });
    return r.json();
  },
  // the outreach report for the last 7 or 30 days, or all time (0)
  getCoverageMatrix: (fresh = false) => jget('/api/coverage' + (fresh ? '?fresh=1' : '')) as Promise<CoverageMatrixData>,
  getCoverageMissing: (type: string, country: string, kind: CoverageRow['kind']) => jget('/api/coverage/missing?' + new URLSearchParams({ type, country, kind })) as Promise<{ ok: boolean; error?: string; batches?: { city: string; areas: string[] }[]; searches?: number }>,
  getOutreachReport: (days: number) => jget('/api/outreach/report?days=' + days) as Promise<OutreachReportData>,
  // may anything be sent today, and why not
  getTodayPlan: () => jget('/api/outreach/today') as Promise<TodayPlanData>,
  getMailLog: (sender = '') => jget('/api/outreach/mail' + (sender ? '?sender=' + encodeURIComponent(sender) : '')) as Promise<MailLogData>,
  getControl: () => jget('/api/outreach/control') as Promise<ControlState>,
  saveControl: (patch: ControlPatch) => jsend('/api/outreach/control', 'POST', patch) as Promise<{ ok: boolean; error?: string }>,
  // send one step to the seed addresses, the operator's own test mailboxes
  sendSeedTest: (senderId: string, sequenceId: string, stepId: string) =>
    jsend('/api/outreach/seed', 'POST', { senderId, sequenceId, stepId }) as Promise<{ ok: boolean; error?: string; sent?: string[]; failed?: string[] }>,
  // one chunk of reading the leads' websites for booking, ordering and Instagram signals; call until `remaining` is 0
  readSiteSignals: () => jsend('/api/outreach/signals', 'POST', {}) as Promise<{ ok: boolean; error?: string; done?: number; found?: number; remaining?: number }>,
  // the operator chooses a lead's second-round offer by hand
  setOffer: (project: string, dedupKey: string, offer: 'ai' | 'social') => jsend('/api/outreach/offer', 'POST', { project, dedupKey, offer }) as Promise<{ ok: boolean; error?: string; offer?: string }>,
  // read one sender mailbox and act on what arrived; a hung request is aborted like a tick
  outreachInbox: async (timeoutMs: number): Promise<InboxRoundResult> => {
    const r = await fetch('/api/outreach/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(timeoutMs) });
    return r.json();
  },
  getInbox: (show: 'replies' | 'bounces' | 'unmatched') =>
    jget('/api/outreach/inbox?show=' + show) as Promise<{ ok: boolean; error?: string; items?: InboxItem[]; unseen?: number; oldestUnseenAt?: string }>,
  markRepliesSeen: () => jsend('/api/outreach/inbox', 'PATCH', { seen: 'all' }) as Promise<{ ok: boolean; error?: string; marked?: number }>,
  // the operator says by hand that a lead answered: its sequence stops
  markReplied: (project: string, dedupKey: string) => jsend('/api/outreach/replied', 'POST', { project, dedupKey }) as Promise<{ ok: boolean; error?: string; stopped?: boolean }>,
  getSuppressions: (search = '') => jget('/api/outreach/suppressions?search=' + encodeURIComponent(search)) as Promise<{ ok: boolean; error?: string; rows?: SuppressionRow[]; total?: number }>,
  // add an address, add a company domain, or lift a suppression: the operator's own hand, nothing automatic
  changeSuppression: (action: 'add' | 'addDomain' | 'remove', value: string) => jsend('/api/outreach/suppressions', 'POST', { action, value }) as Promise<{ ok: boolean; error?: string }>,
  getUnknownSends: () => jget('/api/outreach/unknown') as Promise<{ ok: boolean; error?: string; sends?: UnknownSendRow[] }>,
  settleUnknownSend: (id: string, decision: 'sent' | 'resend') => jsend('/api/outreach/unknown', 'POST', { id, decision }) as Promise<{ ok: boolean; error?: string; moved?: boolean }>,
  // outreach sequences
  getSequences: () => jget('/api/outreach/sequences') as Promise<{ ok: boolean; error?: string; sequences?: OutreachSequenceRow[]; activeCapped?: boolean }>,
  addSequence: (s: SequenceInput) => jsend('/api/outreach/sequences', 'POST', s) as Promise<SequenceSaved>,
  updateSequence: (sequenceId: string, patch: SequenceInput) => jsend('/api/outreach/sequences/' + encodeURIComponent(sequenceId), 'PATCH', patch) as Promise<SequenceSaved>,
  // also takes every active lead out of the sequence; `stopped` is how many
  deleteSequence: (sequenceId: string) => jsend('/api/outreach/sequences/' + encodeURIComponent(sequenceId), 'DELETE', {}) as Promise<{ ok: boolean; error?: string; stopped?: number }>,
  // the emails as one real lead would get them; `skip` picks another lead, `steps` previews an unsaved edit
  previewSequence: (sequenceId: string, body: { project?: string; dedupKey?: string; skip?: number; steps?: SequenceInput['steps'] }) =>
    jsend('/api/outreach/sequences/' + encodeURIComponent(sequenceId) + '/preview', 'POST', body) as Promise<SequencePreview>,
  checkSequence: (sequenceId: string, patch: SequenceInput) =>
    jsend('/api/outreach/sequences/' + encodeURIComponent(sequenceId) + '/check', 'POST', patch) as Promise<SequenceCheck>,
  // The filter travels as the same query string GET /api/leads gets, so the
  // server selects exactly the leads the table shows.
  enroll: (c: EnrollCall) => jsend('/api/outreach/enroll', 'POST', {
    ...c, source: c.source.kind === 'filter' ? { kind: 'filter', query: leadsParams(c.source.query).toString() } : c.source,
  }) as Promise<EnrollResult>,
  // leads that would pass every enrolment rule right now, best score first; writes nothing
  suggestLeads: (sequenceId: string, country: string, n: number, exclude: string[], region = '', place = '') =>
    jsend('/api/outreach/suggest', 'POST', { sequenceId, country, region, place, n, exclude }) as Promise<{ ok: boolean; error?: string; picks?: SuggestedLead[]; examined?: number; skipped?: Record<string, number> }>,
  // sender accounts (the app password goes in, it never comes back)
  getSenders: () => jget('/api/outreach/senders') as Promise<{ ok: boolean; error?: string; senders?: OutreachSenderRow[] }>,
  addSender: (s: SenderInput) => jsend('/api/outreach/senders', 'POST', s) as Promise<{ ok: boolean; error?: string; senderId?: string }>,
  updateSender: (senderId: string, patch: Partial<SenderInput> & { active?: boolean; restartWarmup?: boolean }) =>
    jsend('/api/outreach/senders', 'PATCH', { senderId, ...patch }) as Promise<{ ok: boolean; error?: string }>,
  testSender: (senderId: string) => jsend('/api/outreach/senders/test', 'POST', { senderId }) as Promise<SenderTest>,
  // whether the deployed function reaches Gmail's SMTP and IMAP ports (greeting only, no login)
  outreachPortTest: () => jget('/api/outreach/porttest'),
};
