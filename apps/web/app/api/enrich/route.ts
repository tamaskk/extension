// AI enrichment — generates 4 fields per lead (summary / pain points / advantages
// / sales pitch) using the LOCALLY INSTALLED Claude CLI (`claude -p`). Runs only on
// localhost (the dev server spawns the CLI); results are stored in MongoDB so they
// show up in the dashboard everywhere. Call repeatedly to chew through all leads.
//
//   POST /api/enrich  { dedupKey }                         → enrich one lead
//   POST /api/enrich  { limit?, concurrency?, force?,      → enrich a batch of
//                       scope?: { folder?, project?, hasReviews? } }   un-enriched leads
import { dbConnect } from '@/lib/db';
import { Lead, Review, Project, CORS, json, descendantFolderIds } from '@/lib/models';
import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel cap; enrichment only runs locally anyway (dev server has no 300s limit)
export function OPTIONS() { return new Response(null, { headers: CORS }); }

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || ''; // '' = the CLI's default model

// Only allow on localhost (where the Claude CLI lives). Set ENRICH_ALLOW=1 to override.
function isLocal(req: Request) {
  if (process.env.ENRICH_ALLOW === '1') return true;
  const host = (req.headers.get('host') || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?$/.test(host);
}

// Run the local Claude CLI with the prompt on stdin; returns the assistant's text.
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json'];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    const child = spawn(CLAUDE_BIN, args, { timeout: 150000 });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error('spawn ' + CLAUDE_BIN + ' failed: ' + (e as Error).message)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('claude exited ' + code + ': ' + err.slice(0, 400)));
      try {
        const wrap = JSON.parse(out);            // { type:'result', result:'...', ... }
        resolve(typeof wrap?.result === 'string' ? wrap.result : out);
      } catch { resolve(out); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Pull the {summary, painPoints, advantages, pitch} JSON out of the model's reply.
function parseInsights(text: string) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (t[0] !== '{') { const i = t.indexOf('{'), j = t.lastIndexOf('}'); if (i >= 0 && j > i) t = t.slice(i, j + 1); }
  const o = JSON.parse(t);
  const asText = (v: unknown) => Array.isArray(v) ? v.map((x) => '• ' + String(x).replace(/^[•\-*]\s*/, '').trim()).join('\n') : String(v || '').trim();
  return {
    aiSummary: String(o.summary || '').trim(),
    aiPainPoints: asText(o.painPoints),
    aiAdvantages: asText(o.advantages),
    aiPitch: String(o.pitch || '').trim(),
  };
}

function buildPrompt(lead: any, reviews: any[]) {
  const facts = [
    `Name: ${lead.name || '(unknown)'}`,
    lead.category ? `Category: ${lead.category}` : '',
    lead.address ? `Address: ${lead.address}` : '',
    lead.phone ? `Phone: ${lead.phone}` : '',
    `Website status: ${lead.websiteStatus || 'unknown'}${lead.website ? ' (' + lead.website + ')' : ''}`,
    lead.rating != null ? `Google rating: ${lead.rating}★ from ${lead.reviewCount ?? '?'} reviews` : '',
  ].filter(Boolean).join('\n');
  const revText = reviews.length
    ? reviews.map((r, i) => `${i + 1}. [${r.rating != null ? r.rating + '★' : 'no rating'}] ${String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 400)}`).filter((l) => l.length > 8).join('\n')
    : '(no reviews scraped)';
  return `You are a B2B sales strategist for a digital agency that sells websites, online presence, SEO and lead-gen services to local businesses. Analyse ONE prospect and produce concise, specific, actionable insights a salesperson can use on a cold call.

BUSINESS DATA:
${facts}

CUSTOMER REVIEWS (most recent first):
${revText}

Return ONLY a JSON object (no prose, no code fences) with EXACTLY these keys:
{
  "summary": "2-3 sentence plain-English summary of what this business is and how it's perceived, grounded in the data and reviews",
  "painPoints": ["3-5 concrete weaknesses / gaps / problems — e.g. no website, complaints in reviews, weak online presence; each a short phrase"],
  "advantages": ["3-5 concrete strengths — e.g. strong ratings, loyal customers, good reputation; each a short phrase"],
  "pitch": "3-5 sentences: exactly how our agency should sell to them — which pain point to lead with, what service to offer, and the single most persuasive angle"
}
Base everything on the supplied data; do not invent facts. If reviews are missing, infer cautiously from the rest.`;
}

const nLines = (s: string) => s.split('\n').filter((x) => x.trim()).length;

async function enrichOne(lead: any, tag = '') {
  const t0 = Date.now();
  const name = lead.name || lead.dedupKey;
  const reviews = await Review.find({ dedupKey: lead.dedupKey }).sort({ scrapedAt: -1, _id: -1 }).limit(30).select('rating text -_id').lean();
  console.log(`[enrich]${tag} ▶ ${name}  (${reviews.length} reviews) — asking Claude…`);
  const text = await runClaude(buildPrompt(lead, reviews as any[]));
  const ai = parseInsights(text);
  const aiAt = new Date().toISOString();
  await Lead.updateOne({ dedupKey: lead.dedupKey }, { $set: { ...ai, aiAt } });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[enrich]${tag} ✓ ${name} — ${ai.aiSummary.length}c summary · ${nLines(ai.aiAdvantages)} advantages · ${nLines(ai.aiPainPoints)} pain points · pitch ${ai.aiPitch.length}c  (${secs}s)`);
  return { ...ai, aiAt };
}

const LEAD_FIELDS = 'dedupKey name category address phone website websiteStatus rating reviewCount aiAt -_id';

export async function POST(req: Request) {
  if (!isLocal(req)) return json({ ok: false, error: 'AI enrichment only runs on localhost (it spawns your local Claude CLI). Run the app with `npm run dev` and call it from localhost.' }, { status: 403 });
  try {
    await dbConnect();
    const b = await req.json().catch(() => ({}));

    // ── single lead ──
    if (b.dedupKey) {
      const lead = await Lead.findOne({ dedupKey: String(b.dedupKey) }).select(LEAD_FIELDS).lean() as any;
      if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
      try {
        const ai = await enrichOne(lead);
        return json({ ok: true, ai });
      } catch (e: any) {
        console.error(`[enrich] ✗ ${lead.name || lead.dedupKey} — ${e?.message || e}`);
        return json({ ok: false, error: e?.message || 'claude failed' }, { status: 500 });
      }
    }

    // ── batch ──
    const limit = Math.min(Math.max(Number(b.limit) || 20, 1), 500);
    const concurrency = Math.min(Math.max(Number(b.concurrency) || 4, 1), 12);
    const match: Record<string, unknown> = {};
    if (!b.force) match.aiAt = { $in: [null, ''] };           // only un-enriched (unless force)
    const scope = b.scope || {};
    if (scope.hasReviews) match.reviewsCount = { $gt: 0 };
    if (scope.folder) {
      const ids = await descendantFolderIds(String(scope.folder));
      const projs = await Project.find({ folderId: { $in: ids } }).select('query -_id').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else if (scope.project) {
      match.project = String(scope.project);
    }

    const totalRemaining = await Lead.countDocuments(match);
    const leads = await Lead.find(match).sort({ scrapedAt: -1, _id: -1 }).limit(limit).select(LEAD_FIELDS).lean() as any[];
    if (!leads.length) { console.log('[enrich] batch: nothing left to enrich — done.'); return json({ ok: true, processed: 0, ok_count: 0, errors: 0, remaining: 0, done: true }); }
    console.log(`[enrich] ── batch start: ${leads.length} leads · concurrency ${concurrency} · ${totalRemaining} total left${scope.hasReviews ? ' · hasReviews' : ''}${scope.folder ? ' · folder ' + scope.folder : ''} ──`);

    const t0 = Date.now();
    let ok = 0, errors = 0, started = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < leads.length) {
        const i = cursor++;
        const lead = leads[i];
        const tag = ` [${++started}/${leads.length}]`;
        try { await enrichOne(lead, tag); ok++; }
        catch (e: any) { errors++; console.error(`[enrich]${tag} ✗ ${lead.name || lead.dedupKey} — ${e?.message || e}`); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, () => worker()));

    const remaining = await Lead.countDocuments(match);
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`[enrich] ── batch done: ${ok} ok · ${errors} errors · ${remaining} still remaining · ${mins} min ──`);
    return json({ ok: true, processed: leads.length, ok_count: ok, errors, remaining, done: remaining === 0 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'enrich failed' }, { status: 500 });
  }
}
