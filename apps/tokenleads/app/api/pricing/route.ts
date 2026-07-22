import { NextResponse } from 'next/server';
import { getPricing, PACKAGES } from '@/lib/pricing';

export async function GET() {
  const pricing = await getPricing();
  return NextResponse.json({ ok: true, pricing, packages: PACKAGES });
}
