import { dbConnect } from '@/lib/db';
import { Lead, Project, CORS, json, descendantFolderIds } from '@/lib/models';
import { recomputeProjectStats } from '@/lib/projectStats';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Automated contact (email) research over a project/folder's email-less leads.
// The dashboard drives the queue one lead at a time so a run can be stopped at
// any point. Uses an OpenAI model WITH web search (LEAD_SEARCH_MODEL env
// overrides; default gpt-4o-search-preview) — it must find a really published
// address, never guess one.

const MODEL = () => process.env.LEAD_SEARCH_MODEL || 'gpt-4o-search-preview';

// GET ?project=|folder=&retry=1 → the queue: leads without email, best first
export async function GET(req: Request) {
  try {
    await dbConnect();
    const u = new URL(req.url).searchParams;
    const project = u.get('project') || '';
    const folder = u.get('folder') || '';
    const retry = u.get('retry') === '1';
    if (!project && !folder) return json({ ok: false, error: 'project or folder required' }, { status: 400 });

    const match: Record<string, unknown> = { email: { $in: ['', null] } };
    if (!retry) match.emailSearchAt = { $in: ['', null] }; // skip leads a previous run already tried
    if (folder) {
      const ids = await descendantFolderIds(folder);
      const projs = await Project.find({ folderId: { $in: ids } }).select('query -_id').lean();
      match.project = { $in: (projs as { query: string }[]).map((p) => p.query) };
    } else {
      match.project = project;
    }
    const docs = await Lead.find(match)
      .sort({ opportunityScore: -1, _id: 1 })   // most valuable leads first
      .limit(1000)
      .select('project dedupKey name address phone category website websiteStatus -_id')
      .lean();
    return json({ ok: true, rows: docs, capped: (docs as unknown[]).length === 1000 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'queue failed' }, { status: 500 });
  }
}

// POST { project, dedupKey } → research ONE lead; saves the found email
export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI || '';
    if (!key) return json({ ok: false, error: 'Missing OPENAI env var.' }, { status: 400 });
    await dbConnect();
    const b = await req.json();
    const lead = await Lead.findOne({ project: b.project, dedupKey: b.dedupKey })
      .select('project name address phone category website email -_id').lean() as any;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
    if (lead.email) return json({ ok: true, skipped: true, email: lead.email });

    const biz = [
      `Business: ${lead.name || ''}`,
      `Category: ${lead.category || ''}`,
      `Address: ${lead.address || ''}`,
      lead.phone ? `Phone: ${lead.phone}` : '',
      lead.website ? `Website: ${lead.website}` : '',
    ].filter(Boolean).join('\n');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        web_search_options: { search_context_size: 'medium' },
        messages: [
          {
            role: 'system',
            content: 'You are a B2B contact researcher with live web search. Find a PUBLICLY LISTED email address for the given local business — check its official website (contact/about/footer pages), Google Business profile, Facebook/Instagram page, and reputable business directories. Prefer an owner or business inbox over generic directory scrapes. Reply ONLY with a JSON object, no other text: {"email": string|null, "owner": string|null, "source": string|null}. STRICT RULE: only report an address you actually saw published in a source; never guess, derive or fabricate one. If nothing verifiable is found, use null.',
          },
          { role: 'user', content: `Find the public contact email for this business:\n\n${biz}` },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: data?.error?.message || `OpenAI HTTP ${r.status}` }, { status: 502 });
    const text: string = data.choices?.[0]?.message?.content || '';
    let email = '', owner = '', source = '';
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const p = m ? JSON.parse(m[0]) : {};
      email = typeof p.email === 'string' ? p.email.trim() : '';
      owner = typeof p.owner === 'string' ? p.owner.trim() : '';
      source = typeof p.source === 'string' ? p.source.trim() : '';
    } catch { /* unparseable → treat as not found */ }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) email = '';

    const at = new Date().toISOString();
    const set: Record<string, string> = { emailSearchAt: at };
    if (email) set.email = email;
    await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: set });
    if (email) await recomputeProjectStats([b.project]); // email counter changed
    return json({ ok: true, found: !!email, email, owner, source });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'search failed' }, { status: 500 });
  }
}
