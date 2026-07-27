import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST { project, dedupKey, context } → GPT writes a personalized cold-outreach
// email for this business and saves it on the lead (regenerate/edit any time).
// Uses the OPENAI env var (OpenAI API key).
export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI || '';
    if (!key) return json({ ok: false, error: 'Missing OPENAI env var (the OpenAI API key) — add it in Vercel and redeploy.' }, { status: 400 });
    await dbConnect();
    const b = await req.json();
    const lead = await Lead.findOne({ project: b.project, dedupKey: b.dedupKey }).lean() as any;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });

    const c = b.context || {};
    const services: string[] = Array.isArray(c.services) ? c.services : [];
    const automations: string[] = Array.isArray(c.automations) ? c.automations : [];
    const websites: string[] = Array.isArray(c.websites) ? c.websites : [];

    // The operator's checked website problems are GROUND TRUTH — they override
    // whatever the scraper stored (e.g. DB says NO_WEBSITE but the operator
    // verified the site exists and is just outdated). Sending both confused the
    // model into "you don't have a website" emails for businesses that do.
    const websiteLine = websites.length
      ? `Website situation (verified by the sender — treat as fact, ignore anything that contradicts it): ${websites.join('; ')}${lead.website ? ` — current site: ${lead.website}` : ''}`
      : `Website status: ${lead.websiteStatus || 'unknown'}${lead.website ? ` (${lead.website})` : ''}`;
    const biz = [
      `Name: ${lead.name || ''}`,
      `Category: ${lead.category || ''}`,
      `Address: ${lead.address || ''}`,
      `Rating: ${lead.rating ?? 'n/a'} (${lead.reviewCount ?? 0} reviews)`,
      websiteLine,
      lead.aiSummary ? `About (from reviews): ${lead.aiSummary}` : '',
    ].filter(Boolean).join('\n');

    const brief = [
      `Services we sell: ${services.join(', ') || 'digital services'}`,
      automations.length ? `AI automations to highlight: ${automations.join('; ')}` : '',
      c.value ? `Core value proposition: ${c.value}` : '',
      c.offer ? `Offer / hook (use this idea): ${c.offer}` : '',
      c.objective ? `Goal of the email: ${c.objective}` : '',
      `Sender name: ${c.sender || 'Tom'}`,
      `Booking link (the ONLY link to include): ${c.link || 'https://calendly.com/tom-itsblitzdeep/30min'}`,
      `Tone: ${c.tone || 'Professional but friendly'}`,
      `Length: ${c.length || 'Medium'} (Short ≈ 60-80 words, Medium ≈ 100-140, Long ≈ 180-220)`,
    ].filter(Boolean).join('\n');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You write short, personal, effective cold-outreach emails for a digital agency. Reply ONLY with JSON: {"subject": string, "body": string}. Plain text body with normal line breaks, ready to send — no HTML, no markdown, no placeholders like [Name]. Personalize to the specific business (reference something concrete: their category, website situation, strong reviews…). The stated website situation is verified fact — never claim the business has no website unless that exact problem is listed, and never contradict the listed problems. One clear call to action: book the call via the booking link. Do not oversell; sound like a human.',
          },
          { role: 'user', content: `Write the email for this business:\n\n${biz}\n\n--- Our pitch ---\n${brief}` },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: data?.error?.message || `OpenAI HTTP ${r.status}` }, { status: 502 });
    let subject = '', body = '';
    try {
      const p = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      subject = String(p.subject || '').trim(); body = String(p.body || '').trim();
    } catch { /* fall through */ }
    if (!body) return json({ ok: false, error: 'OpenAI returned no email' }, { status: 502 });

    const emailAt = new Date().toISOString();
    await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: { emailSubject: subject, emailBody: body, emailAt } });
    return json({ ok: true, subject, body, emailAt });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'email generation failed' }, { status: 500 });
  }
}
