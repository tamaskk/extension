import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { recordSend } from '@/lib/outreachSends';
import { limit } from '@/lib/rateLimit.mjs';
import { isSuppressed } from '@/lib/suppression';
import { parseProjectGeo } from '@/lib/projectGeo';
import { languageOfCountry } from '@/lib/enrollPlan.mjs';
import { footerFor, withFooter } from '@/lib/outreachFooter.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST { project, dedupKey } → send the saved outreach draft to the lead's
// email via Resend, from Tom's address. Needs RESEND_API_KEY (domain
// itsblitzdeep.com verified in Resend); OUTREACH_FROM overrides the sender.
const FROM = () => process.env.OUTREACH_FROM || 'Tom <tom@itsblitzdeep.com>';

export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const key = process.env.RESEND_API_KEY || '';
    if (!key) return json({ ok: false, error: 'Missing RESEND_API_KEY env var — create an API key at resend.com (with itsblitzdeep.com verified) and add it in Vercel.' }, { status: 400 });
    await dbConnect();
    const b = await req.json();
    // strings only: an object here would be a query operator, and would pick a lead of the caller's choosing
    b.project = String(b?.project || ''); b.dedupKey = String(b?.dedupKey || '');
    // a person sends drafts one at a time; a loop does not
    if (!limit('manualsend', 40, 60 * 60_000).ok) return json({ ok: false, error: '40 emails were sent by hand in the last hour. Wait before sending more.' }, { status: 429 });
    const lead = await Lead.findOne({ project: b.project, dedupKey: b.dedupKey })
      .select('email name emailSubject emailBody -_id').lean() as any;
    if (!lead) return json({ ok: false, error: 'lead not found' }, { status: 404 });
    const to = String(lead.email || '').trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, error: `This lead has no valid email address (${to || 'empty'}).` }, { status: 400 });
    if (!lead.emailBody) return json({ ok: false, error: 'No draft to send — generate the email first.' }, { status: 400 });

    // Someone who asked not to be written to must not get an email by hand
    // either. When the list cannot be read the email is not sent: one email
    // less is cheap, one to a suppressed address is not.
    let blocked: boolean;
    try {
      blocked = await isSuppressed(to);
    } catch (e) {
      console.error('send-email: suppression list unavailable', e instanceof Error ? e.message : '');
      return json({ ok: false, error: 'The suppression list could not be checked, so the email was not sent. Try again.' }, { status: 500 });
    }
    if (blocked) return json({ ok: false, error: `${to} is on the suppression list: this address, or its company, asked not to be written to, or it bounced.` }, { status: 400 });

    // A draft written by hand is a commercial email like any other: it gets the
    // same footer as a sequence email (name, postal address, how to stop), in
    // the language of the lead's country. Until FOOTER_IDENTITY is filled in
    // there is no footer, and the draft goes out as before.
    const lang = languageOfCountry(parseProjectGeo(String(b.project))?.country) || 'en';
    const text = withFooter(lead.emailBody, lang);
    const hasFooter = !!footerFor(lang);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM(),
        to: [to],
        subject: lead.emailSubject || `Quick idea for ${lead.name || 'your business'}`,
        text,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = data?.message || data?.error?.message || `Resend HTTP ${r.status}`;
      await logActivity({ type: 'outreach.error', project: b.project, keys: [b.dedupKey], title: `${lead.name || b.dedupKey}: email to ${to} FAILED — ${error}`, data: { name: lead.name, to, error } });
      // the provider's own words go to the activity log for the operator, not to the response
      return json({ ok: false, error: `The email provider refused the email (HTTP ${r.status}). The details are in the Changelog.` }, { status: 502 });
    }

    const emailSentAt = new Date().toISOString();
    await Lead.updateOne({ project: b.project, dedupKey: b.dedupKey }, { $set: { emailSentAt, emailSentTo: to } });
    await logActivity({ type: 'outreach.sent', project: b.project, keys: [b.dedupKey], n: 1, title: `${lead.name || b.dedupKey}: email sent to ${to}`, data: { name: lead.name, to, subject: lead.emailSubject, body: text, resendId: data?.id || '' } });
    // The email is out: a failed report row must not turn the answer into an error.
    try {
      await recordSend({ project: String(b.project), dedupKey: String(b.dedupKey), to, sentAt: emailSentAt });
    } catch (e) {
      console.error('outreach send row not written', e instanceof Error ? e.message : '');
    }
    return json({ ok: true, id: data?.id || '', to, emailSentAt, footer: hasFooter });
  } catch (e) {
    // the library's own message can carry a host or a key: it stays in the server log
    console.error('send-email failed', e instanceof Error ? e.message.slice(0, 200) : '');
    return json({ ok: false, error: 'The email could not be sent.' }, { status: 500 });
  }
}
