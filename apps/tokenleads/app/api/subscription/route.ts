import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Subscription } from '@/lib/models';
import { requireSession, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { PLANS } from '@/lib/pricing';
import { credit } from '@/lib/tokens';
import { stripeEnabled, createCheckoutSession, stripeApi } from '@/lib/stripe';
import { limit } from '@/lib/rateLimit';
import { logEvent, logError } from '@/lib/monitoring';

export async function GET() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  const sub = await Subscription.findOne({ userId: s.uid }).lean() as
    { plan: string; status: string; provider: string; currentPeriodEnd: Date } | null;
  return NextResponse.json({ ok: true, subscription: sub ? {
    plan: sub.plan, status: sub.status, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd,
  } : null, plans: PLANS });
}

// Subscribe. Stripe: Checkout (activation via webhook). Mock: instant activation
// + first monthly grant; renewals happen in /api/cron/subscriptions.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const rl = limit(`sub:${s.uid}`, 5, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const body = await req.json().catch(() => null);
  const plan = PLANS.find((p) => p.id === body?.planId);
  if (!plan) return jsonError(400, 'unknown plan');

  await dbConnect();
  const existing = await Subscription.findOne({ userId: s.uid, status: 'active' }).lean();
  if (existing) return jsonError(409, 'already subscribed');

  const appUrl = process.env.APP_URL || 'http://localhost:3010';

  if (stripeEnabled()) {
    try {
      const session = await createCheckoutSession({
        mode: 'subscription',
        name: `TokenLeads ${plan.label} — ${plan.tokensPerMonth} token/hó`,
        priceCents: plan.priceCents,
        metadata: { kind: 'subscription', userId: s.uid, plan: plan.id },
        successUrl: `${appUrl}/wallet?sub=success`,
        cancelUrl: `${appUrl}/wallet?sub=cancel`,
        customerEmail: s.email,
      });
      return NextResponse.json({ ok: true, url: session.url });
    } catch (e) {
      logError('subscription_checkout_failed', e, { userId: s.uid });
      return jsonError(502, 'payment provider error');
    }
  }

  // MOCK
  const periodEnd = new Date(Date.now() + 30 * 86400_000);
  const sub = await Subscription.findOneAndUpdate(
    { userId: new Types.ObjectId(s.uid) },
    { $set: { plan: plan.id, status: 'active', provider: 'mock', providerRef: `mock:${s.uid}`, currentPeriodEnd: periodEnd, canceledAt: null } },
    { new: true, upsert: true },
  ).lean() as { _id: unknown };
  const { balance } = await credit({
    userId: s.uid, amount: plan.tokensPerMonth, type: 'subscription_grant',
    description: `Előfizetés jóváírás — ${plan.label} (${plan.tokensPerMonth} token/hó) [MOCK]`,
    idempotencyKey: `subgrant:${sub._id}:${periodEnd.toISOString().slice(0, 10)}`,
  });
  logEvent('subscription_activated_mock', { userId: s.uid, plan: plan.id });
  return NextResponse.json({ ok: true, mock: true, balance, plan: plan.id, currentPeriodEnd: periodEnd });
}

// Cancel — runs until the end of the paid period. For Stripe subscriptions we
// must also cancel at the provider, otherwise the card keeps getting billed and
// the next invoice.paid webhook flips the sub back to active.
export async function DELETE() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();

  const active = await Subscription.findOne({ userId: s.uid, status: 'active' }).lean() as
    { provider: string; providerRef: string } | null;
  if (!active) return jsonError(404, 'no active subscription');

  if (active.provider === 'stripe' && active.providerRef) {
    try {
      // cancel_at_period_end keeps access until the paid period ends.
      await stripeApi(`subscriptions/${active.providerRef}`, { cancel_at_period_end: true });
    } catch (e) {
      logError('subscription_stripe_cancel_failed', e, { userId: s.uid });
      return jsonError(502, 'payment provider error — subscription not canceled');
    }
  }

  await Subscription.updateOne({ userId: s.uid, status: 'active' }, { $set: { status: 'canceled', canceledAt: new Date() } });
  logEvent('subscription_canceled', { userId: s.uid, provider: active.provider });
  return NextResponse.json({ ok: true });
}
