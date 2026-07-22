import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { dbConnect } from '@/lib/db';
import { PromoCode } from '@/lib/models';
import { requireAdmin, isResponse, jsonError } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();
  const promos = await PromoCode.find().sort({ createdAt: -1 }).limit(200).lean();
  return NextResponse.json({ ok: true, promos });
}

export async function POST(req: NextRequest) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  const body = await req.json().catch(() => null);
  const tokens = Math.floor(Number(body?.tokens));
  const maxUses = Math.floor(Number(body?.maxUses));
  let code = String(body?.code || '').trim().toUpperCase();
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
  if (!Number.isFinite(tokens) || tokens <= 0) return jsonError(400, 'tokens must be positive');
  if (!Number.isFinite(maxUses) || maxUses <= 0) return jsonError(400, 'maxUses must be positive');
  if (!code) code = `TL${randomBytes(3).toString('hex').toUpperCase()}`;

  await dbConnect();
  try {
    const promo = await PromoCode.create({ code, tokens, maxUses, expiresAt, createdBy: s.email });
    return NextResponse.json({ ok: true, promo });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000) return jsonError(409, 'code already exists');
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  const code = req.nextUrl.searchParams.get('code')?.toUpperCase();
  if (!code) return jsonError(400, 'code required');
  await dbConnect();
  await PromoCode.deleteOne({ code });
  return NextResponse.json({ ok: true });
}
