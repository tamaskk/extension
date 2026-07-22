import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Wallet, TokenTransaction, Reconciliation } from '@/lib/models';
import { checkCron } from '@/lib/cronAuth';
import { logEvent, logError } from '@/lib/monitoring';

// Ledger ↔ wallet integrity check. A wallet whose cached balance differs from
// SUM(ledger.amount) indicates a crash between decrement and ledger insert.
// ?fix=1 rewrites the wallet balance to the ledger truth (ledger wins — it's
// the source of truth by design).
export async function GET(req: NextRequest) {
  const denied = checkCron(req);
  if (denied) return denied;
  await dbConnect();

  const sums = await TokenTransaction.aggregate([
    { $group: { _id: '$userId', total: { $sum: '$amount' } } },
  ]) as { _id: unknown; total: number }[];
  const sumByUser = new Map(sums.map((s) => [String(s._id), s.total]));

  const wallets = await Wallet.find().lean() as unknown as { userId: unknown; balance: number }[];
  const mismatches: { userId: string; walletBalance: number; ledgerSum: number }[] = [];
  for (const w of wallets) {
    const ledger = sumByUser.get(String(w.userId)) ?? 0;
    if (ledger !== w.balance) {
      mismatches.push({ userId: String(w.userId), walletBalance: w.balance, ledgerSum: ledger });
    }
  }

  let fixed = 0;
  if (req.nextUrl.searchParams.get('fix') === '1') {
    for (const m of mismatches) {
      try {
        await Wallet.updateOne({ userId: m.userId, balance: m.walletBalance }, { $set: { balance: m.ledgerSum, updatedAt: new Date() } });
        fixed++;
        logEvent('reconcile_fixed', m);
      } catch (e) {
        logError('reconcile_fix_failed', e, m);
      }
    }
  }

  await Reconciliation.create({ ranAt: new Date(), checked: wallets.length, mismatches, fixed });
  if (mismatches.length) logError('reconcile_mismatch_found', new Error('ledger/wallet mismatch'), { count: mismatches.length });
  else logEvent('reconcile_clean', { checked: wallets.length });

  return NextResponse.json({ ok: true, checked: wallets.length, mismatches, fixed });
}
