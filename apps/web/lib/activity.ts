// Activity log — the data behind the Changelog view.
// Every write path (extension sync, email audit, lead edits, project/folder
// moves, outreach, deletes…) appends an event to the `activities` collection.
// Append-only and never pruned: this is the permanent "what happened, where,
// when" record.
//
// Event: { ts: Date, type, title, project?, keys?, n?, data?, source, text }
//   type   dotted ("leads.new", "email.audit", "lead.edit", "project.move"…);
//          the part before the dot is what the Changelog filters on
//   keys   dedupKeys of the leads the event touched (indexed → per-lead history)
//   n      how many things it covers (leads added, emails found…) — summed in the tiles
//   text   lower-cased haystack for the Changelog's search box
//
// Native driver on purpose (no mongoose model): events are free-form, and a dev
// server that hot-reloads keeps old schemas cached and would strip new fields.
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';

export interface ActivityInput {
  type: string;
  title: string;
  project?: string;
  keys?: string[];
  n?: number;
  data?: Record<string, unknown>;
  source?: 'web' | 'extension' | 'system';
}

export type Diff = Record<string, [unknown, unknown]>;

let indexed = false;
export async function activityColl() {
  await dbConnect();
  const c = mongoose.connection.db!.collection('activities');
  if (!indexed) {
    indexed = true;
    c.createIndexes([
      { key: { ts: -1 } },
      { key: { type: 1, ts: -1 } },
      { key: { project: 1, ts: -1 } },
      { key: { keys: 1, ts: -1 } },
    ]).catch(() => { indexed = false; });
  }
  return c;
}

function haystack(e: ActivityInput) {
  let d = '';
  try { d = e.data ? JSON.stringify(e.data) : ''; } catch { /* unserialisable → title only */ }
  return `${e.title} ${e.project || ''} ${d}`.toLowerCase().slice(0, 8000);
}

// Never throws: a logging failure must not fail the write it describes.
export async function logActivity(input: ActivityInput | (ActivityInput | null | undefined | false)[]) {
  try {
    const list = (Array.isArray(input) ? input : [input]).filter(Boolean) as ActivityInput[];
    if (!list.length) return;
    const ts = new Date();
    await (await activityColl()).insertMany(list.map((e) => ({ ts, source: 'web', ...e, text: haystack(e) })), { ordered: false });
  } catch (e: any) {
    console.warn('[activity] log failed:', e?.message);
  }
}

const blank = (v: unknown) => (v === undefined || v === null ? '' : v);
const same = (a: unknown, b: unknown) => JSON.stringify(blank(a)) === JSON.stringify(blank(b));

// { field: [old, new] } for every listed field that `after` defines and changes.
export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, fields: string[]): Diff {
  const out: Diff = {};
  for (const f of fields) {
    if (!(f in after) || after[f] === undefined) continue;
    const a = before ? before[f] : undefined;
    if (!same(a, after[f])) out[f] = [blank(a), blank(after[f])];
  }
  return out;
}

const short = (v: unknown) => { const s = Array.isArray(v) ? v.join(', ') : String(blank(v)); return s === '' ? '∅' : s.length > 60 ? s.slice(0, 60) + '…' : s; };

// Free-text fields the UI auto-saves while you type. Logging each save would
// bury everything else, so edits within this window collapse into one event
// that keeps the ORIGINAL "before" and the latest "after".
const AUTOSAVE: Record<string, { type: string; label: string }> = {
  notes: { type: 'lead.note', label: 'notes' },
  emailSubject: { type: 'outreach.edit', label: 'email subject' },
  emailBody: { type: 'outreach.edit', label: 'email draft' },
  smsBody: { type: 'outreach.edit', label: 'SMS draft' },
};
const COALESCE_MS = 15 * 60 * 1000;

// One manual edit of one lead (the PATCH /api/leads path).
export async function logLeadEdit(project: string, dedupKey: string, name: string, diff: Diff) {
  try {
    const who = name || dedupKey;
    const plain: Diff = {};
    for (const [f, pair] of Object.entries(diff)) {
      const auto = AUTOSAVE[f];
      if (!auto) { plain[f] = pair; continue; }
      const c = await activityColl();
      const ts = new Date();
      const title = `${who}: ${auto.label} ${blank(pair[1]) === '' ? 'cleared' : 'edited'}`;
      const data = { field: f, to: pair[1] };
      const hit = await c.findOneAndUpdate(
        { type: auto.type, keys: dedupKey, 'data.field': f, ts: { $gt: new Date(ts.getTime() - COALESCE_MS) } },
        { $set: { ts, title, 'data.to': pair[1], text: `${title} ${project} ${String(blank(pair[1]))}`.toLowerCase().slice(0, 8000) } },
        { sort: { ts: -1 } },
      );
      if (!hit) await logActivity({ type: auto.type, project, keys: [dedupKey], n: 1, title, data: { name: who, ...data, from: pair[0] } });
    }
    const fields = Object.keys(plain);
    if (!fields.length) return;
    const title = fields.length === 1
      ? `${who}: ${fields[0]} ${short(plain[fields[0]][0])} → ${short(plain[fields[0]][1])}`
      : `${who}: ${fields.length} fields edited (${fields.join(', ')})`;
    await logActivity({ type: 'lead.edit', project, keys: [dedupKey], n: 1, title, data: { name: who, diff: plain } });
  } catch (e: any) {
    console.warn('[activity] lead edit log failed:', e?.message);
  }
}
