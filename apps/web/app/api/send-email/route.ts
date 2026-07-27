import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST { project, dedupKey } → send the saved outreach draft to the lead's
// email via Resend, from Tom's address. Needs RESEND_API_KEY (domain
// itsblitzdeep.com verified in Resend); OUTREACH_FROM overrides the sender.
const FROM = () => process.env.OUTREACH_FROM || 'Tom <tom@itsblitzdeep.com>';

export async function POST(req: Request) {
  try {
    const key = process.env.RESEND_API_KEY || '';
    if (!key) return json({ ok: false, error: 'Missing RESEND_API_KEY env var — create an API key at resend.com (with itsblitzdeep.com verified) and add it in Vercel.' }, { status: 400 });
    await dbConnect();
    const b = await req.json();
    const lead = await Lead.findOne({ project: b.project, dedupKey: b.dedupKey })
      .select('email name emailSubject emailBody -_id').lean() as any;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
    const to = String(lead.email || '').trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, error: `This lead has no valid email address (${to || 'empty'}).` }, { status: 400 });
    if (!lead.emailBody) return json({ ok: false, error: 'No draft to send — generate the email first.' }, { status: 400 });

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM(),
        to: [to],
        subject: lead.emailSubject || `Quick idea for ${lead.name || 'your business'}`,
        text: lead.emailBody,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: data?.message || data?.error?.message || `Resend HTTP ${r.status}` }, { status: 502 });

    const emailSentAt = new Date().toISOString();
    await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: { emailSentAt, emailSentTo: to } });
    return json({ ok: true, id: data?.id || '', to, emailSentAt });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'send failed' }, { status: 500 });
  }
}
