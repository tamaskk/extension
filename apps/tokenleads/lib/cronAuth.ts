import { NextRequest, NextResponse } from 'next/server';

// Cron endpoints: require `Authorization: Bearer <CRON_SECRET>` when the
// secret is configured (Vercel Cron sends it automatically). Without a
// configured secret (local dev) requests are allowed.
export function checkCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return null;
  return NextResponse.json({ ok: false, error: 'unauthorized cron' }, { status: 401 });
}
