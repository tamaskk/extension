import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { PromoCode, PromoRedemption } from '@/lib/models';
import { requireSession, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { credit } from '@/lib/tokens';
import { limit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/monitoring';

// Promo code redemption. Order matters for atomicity:
//   1. unique redemption insert  → blocks the same user redeeming twice
//   2. conditional usedCount inc → blocks exceeding maxUses under races
//   3. idempotent credit         → blocks double-crediting on retries
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const rl = limit(`promo:${s.uid}`, 5, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const body = await req.json().catch(() => null);
  const code = String(body?.code || '').trim().toUpperCase();
  if (!code) return jsonError(400, 'code required');

  await dbConnect();
  const promo = await PromoCode.findOne({ code }).lean() as
    { code: string; tokens: number; maxUses: number; usedCount: number; expiresAt: Date | null } | null;
  if (!promo) return jsonError(404, 'invalid_code');
  if (promo.expiresAt && promo.expiresAt < new Date()) return jsonError(410, 'code_expired');

  try {
    await PromoRedemption.create({ code, userId: s.uid });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000) return jsonError(409, 'already_redeemed');
    throw e;
  }

  const bumped = await PromoCode.findOneAndUpdate(
    { code, usedCount: { $lt: promo.maxUses } },
    { $inc: { usedCount: 1 } },
    { new: true },
  ).lean();
  if (!bumped) {
    await PromoRedemption.deleteOne({ code, userId: s.uid });
    return jsonError(410, 'code_exhausted');
  }

  let balance: number;
  try {
    ({ balance } = await credit({
      userId: s.uid, amount: promo.tokens, type: 'promo_credit',
      description: `Promóciós kód beváltva — ${code} (+${promo.tokens} token)`,
      idempotencyKey: `promo:${code}:${s.uid}`,
    }));
  } catch (e) {
    // Compensate so the user isn't locked out with zero tokens — free the
    // redemption slot and the use count, then surface a retryable error.
    await PromoRedemption.deleteOne({ code, userId: s.uid }).catch(() => {});
    await PromoCode.updateOne({ code }, { $inc: { usedCount: -1 } }).catch(() => {});
    throw e;
  }
  logEvent('promo_redeemed', { userId: s.uid, code, tokens: promo.tokens });
  return NextResponse.json({ ok: true, balance, tokens: promo.tokens });
}
