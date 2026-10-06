import { CORS, json } from '@/lib/models';
import { testSenderConnection } from '@/lib/outreachSenders';
import { refuseUnlessOperator } from '@/lib/session';
import { limit } from '@/lib/rateLimit.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/senders/test  { senderId }
// Logs in to the account over SMTP and IMAP with the stored app password.
// Answers ok or not, with a sentence of our own for each channel: the mail
// server's own words can carry the login name, so they never leave the server.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    const b = await req.json().catch(() => ({}));
    const senderId = String(b?.senderId || '');
    if (!senderId) return json({ ok: false, error: 'senderId required' }, { status: 400 });
    // Each test is two logins at Google. A loop of them can get the mailbox, or
    // the address the function calls from, blocked for a while.
    if (!limit('sendertest:' + senderId, 3, 60_000).ok) return json({ ok: false, error: 'This account was tested a moment ago. Wait a minute and try again.' }, { status: 429 });
    const r = await testSenderConnection(senderId);
    if (!r) return json({ ok: false, error: 'The account was not found.' }, { status: 404 });
    return json({ ok: true, works: r.smtp.ok && r.imap.ok, smtp: r.smtp, imap: r.imap });
  } catch (e) {
    console.error('outreach sender test failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The test could not run: the stored password cannot be opened. Check OUTREACH_SECRET_KEY on the server, or save the password again.' }, { status: 500 });
  }
}
