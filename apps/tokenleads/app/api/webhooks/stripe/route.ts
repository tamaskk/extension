import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Purchase, Subscription } from '@/lib/models';
import { credit } from '@/lib/tokens';
import { verifyStripeSignature } from '@/lib/stripe';
import { PLANS } from '@/lib/pricing';
import { logEvent, logError } from '@/lib/monitoring';

// Stripe webhook. Signature verified manually (HMAC over the raw body).
// All credits are idempotent — Stripe's at-least-once delivery is safe here.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'webhook not configured' }, { status: 501 });

  const rawBody = await req.text();
  if (!verifyStripeSignature(rawBody, req.headers.get('stripe-signature'), secret)) {
    logEvent('stripe_webhook_bad_signature', {});
    return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 400 });
  }

  await dbConnect();
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = (session.metadata || {}) as Record<string, string>;

      if (meta.kind === 'tokens' && meta.purchaseId) {
        const purchase = await Purchase.findById(meta.purchaseId) as
          { _id: unknown; userId: unknown; tokens: number; packageId: string; priceCents: number; status: string } | null;
        if (purchase && purchase.status !== 'completed') {
          // Credit FIRST (idempotent on purchase:<id>), then mark completed. If
          // the process dies between, Stripe retries and re-credits idempotently.
          await credit({
            userId: String(purchase.userId), amount: purchase.tokens, type: 'purchase',
            description: `Token vásárlás — ${purchase.packageId} csomag (${purchase.tokens} token, $${(purchase.priceCents / 100).toFixed(2)})`,
            ref: { purchaseId: purchase._id as Types.ObjectId },
            idempotencyKey: `purchase:${purchase._id}`,
          });
          await Purchase.updateOne({ _id: purchase._id }, { $set: { status: 'completed', completedAt: new Date() } });
          logEvent('purchase_completed_webhook', { purchaseId: String(purchase._id) });
        }
      }

      if (meta.kind === 'subscription' && meta.userId && meta.plan) {
        // Activate the subscription only — the token grant (including the first
        // month) comes from the invoice.paid event, so it's never double-credited.
        const plan = PLANS.find((p) => p.id === meta.plan);
        if (plan) {
          await Subscription.findOneAndUpdate(
            { userId: new Types.ObjectId(meta.userId) },
            { $set: { plan: plan.id, status: 'active', provider: 'stripe', providerRef: String(session.subscription || session.id), currentPeriodEnd: new Date(Date.now() + 31 * 86400_000), canceledAt: null } },
            { upsert: true },
          );
          logEvent('subscription_activated_webhook', { userId: meta.userId, plan: plan.id });
        }
      }
    }

    if (event.type === 'invoice.paid') {
      // Every paid invoice grants one month, keyed by the invoice id so each
      // fires exactly once (the first invoice covers the checkout month too).
      const invoice = event.data.object;
      const subRef = String(invoice.subscription || '');
      const invoiceId = String(invoice.id || '');
      if (subRef && invoiceId) {
        const sub = await Subscription.findOne({ providerRef: subRef, provider: 'stripe' }) as
          { _id: unknown; userId: unknown; plan: string; save: () => Promise<unknown>; currentPeriodEnd: Date; status: string } | null;
        const plan = sub ? PLANS.find((p) => p.id === sub.plan) : null;
        if (sub && plan) {
          sub.currentPeriodEnd = new Date(Date.now() + 31 * 86400_000);
          sub.status = 'active';
          await sub.save();
          await credit({
            userId: String(sub.userId), amount: plan.tokensPerMonth, type: 'subscription_grant',
            description: `Előfizetés jóváírás — ${plan.label} (${plan.tokensPerMonth} token/hó)`,
            idempotencyKey: `subgrant:invoice:${invoiceId}`,
          });
        }
      }
    }
  } catch (e) {
    logError('stripe_webhook_error', e, { type: event.type });
    return NextResponse.json({ ok: false }, { status: 500 }); // Stripe retries
  }

  return NextResponse.json({ ok: true });
}
