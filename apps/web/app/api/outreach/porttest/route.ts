import { CORS, json } from '@/lib/models';
import { probePort } from '@/lib/portProbe.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// GET /api/outreach/porttest
// Whether this function can reach Gmail's SMTP (587) and IMAP (993) ports. Both
// outreach channels depend on it, and it has to be known from a deployed
// function, not from a laptop. It reads the greeting only and sends no login.
export async function GET() {
  try {
    const [smtp, imap] = await Promise.all([
      probePort('smtp.gmail.com', 587, false),
      probePort('imap.gmail.com', 993, true),
    ]);
    return json({ ok: smtp.ok && imap.ok, smtp, imap, region: process.env.VERCEL_REGION || 'local' });
  } catch (e) {
    console.error('outreach port test failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'port test failed' }, { status: 500 });
  }
}
