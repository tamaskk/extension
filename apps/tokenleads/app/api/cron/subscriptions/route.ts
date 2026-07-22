import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Subscription } from '@/lib/models';
import { checkCron } from '@/lib/cronAuth';
import { PLANS } from '@/lib/pricing';
import { credit } from '@/lib/tokens';
import { logEvent, logError } from '@/lib/monitoring';

// Renews MOCK subscriptions whose period ended (Stripe subs renew via the
// invoice.paid webhook instead). Canceled subs simply lapse.
export async function GET(req: NextRequest) {
  const denied = checkCron(req);
  if (denied) return denied;
  await dbConnect();

  const due = await Subscription.find({ status: 'active', provider: 'mock', currentPeriodEnd: { $lte: new Date() } }).lean() as unknown as
    { _id: unknown; userId: unknown; plan: string }[];

  let renewed = 0;
  for (const sub of due) {
    const plan = PLANS.find((p) => p.id === sub.plan);
    if (!plan) continue;
    try {
      const periodEnd = new Date(Date.now() + 30 * 86400_000);
      await Subscription.updateOne({ _id: sub._id }, { $set: { currentPeriodEnd: periodEnd } });
      await credit({
        userId: String(sub.userId), amount: plan.tokensPerMonth, type: 'subscription_grant',
        description: `Előfizetés megújítás — ${plan.label} (${plan.tokensPerMonth} token/hó) [MOCK]`,
        idempotencyKey: `subgrant:${sub._id}:${periodEnd.toISOString().slice(0, 10)}`,
      });
      renewed++;
    } catch (e) {
      logError('subscription_renewal_failed', e, { subId: String(sub._id) });
    }
  }

  logEvent('subscriptions_cron', { due: due.length, renewed });
  return NextResponse.json({ ok: true, due: due.length, renewed });
}
