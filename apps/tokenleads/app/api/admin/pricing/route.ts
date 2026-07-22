import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isResponse, jsonError } from '@/lib/apiUtil';
import { getPricing, setPricing, Pricing } from '@/lib/pricing';

export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  return NextResponse.json({ ok: true, pricing: await getPricing() });
}

export async function PUT(req: NextRequest) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(400, 'invalid body');
  const pricing = await setPricing(body as Partial<Pricing>);
  return NextResponse.json({ ok: true, pricing });
}
