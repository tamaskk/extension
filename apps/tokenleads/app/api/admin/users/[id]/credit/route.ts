import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { User } from '@/lib/models';
import { requireAdmin, isResponse, jsonError } from '@/lib/apiUtil';
import { credit, InsufficientTokensError } from '@/lib/tokens';

// Manual token adjustment (+/-). Reason is mandatory — it IS the audit trail.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid user id');

  const body = await req.json().catch(() => null);
  const amount = Math.floor(Number(body?.amount));
  const reason = String(body?.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) return jsonError(400, 'amount must be a non-zero integer');
  if (!reason) return jsonError(400, 'reason is required');

  await dbConnect();
  const target = await User.findById(id).select('email').lean() as { email: string } | null;
  if (!target) return jsonError(404, 'user not found');

  try {
    const r = await credit({
      userId: id, amount, type: 'admin_adjust',
      description: `Admin korrekció (${s.email}): ${reason}`,
    });
    // Field is 'targetBalance', NOT 'balance' — the client api() helper writes
    // any numeric `balance` into the admin's own header chip, which would show
    // the target user's balance until the next /api/auth/me.
    return NextResponse.json({ ok: true, targetBalance: r.balance, txId: r.txId });
  } catch (e) {
    if (e instanceof InsufficientTokensError) {
      return jsonError(409, 'target balance too low for this deduction', { targetBalance: e.balance });
    }
    throw e;
  }
}
