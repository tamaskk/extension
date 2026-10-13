import { NextRequest, NextResponse } from 'next/server';

// Cron endpoints: require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron
// sends it automatically). Without a configured secret, requests are allowed
// in local dev only. In production they are refused: the jobs change token balances and
// send email, so a forgotten variable must not leave them open to anyone.
export function checkCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null;
    return NextResponse.json({ ok: false, error: 'cron is not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') === `Bearer ${secret}`) return null;
  return NextResponse.json({ ok: false, error: 'unauthorized cron' }, { status: 401 });
}
