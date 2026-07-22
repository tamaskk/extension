import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Purchase } from '@/lib/models';
import { requireSession, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { PACKAGES } from '@/lib/pricing';
import { credit } from '@/lib/tokens';
import { stripeEnabled, createCheckoutSession } from '@/lib/stripe';
import { limit } from '@/lib/rateLimit';
import { logEvent, logError } from '@/lib/monitoring';

// Token top-up. With STRIPE_SECRET_KEY: creates a pending purchase + Checkout
// Session; the credit happens in the webhook. Without it: mock mode — the
// purchase completes instantly through the same state machine.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const rl = limit(`purchase:${s.uid}`, 10, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const body = await req.json().catch(() => null);
  const pkg = PACKAGES.find((p) => p.id === body?.packageId);
  if (!pkg) return jsonError(400, 'unknown package');

  await dbConnect();
  const appUrl = process.env.APP_URL || 'http://localhost:3010';

  if (stripeEnabled()) {
    const purchase = await Purchase.create({
      userId: s.uid, packageId: pkg.id, tokens: pkg.tokens, priceCents: pkg.priceCents,
      status: 'pending', provider: 'stripe',
    });
    try {
      const session = await createCheckoutSession({
        mode: 'payment',
        name: `TokenLeads — ${pkg.label} csomag (${pkg.tokens} token)`,
        priceCents: pkg.priceCents,
        metadata: { purchaseId: String(purchase._id), userId: s.uid, kind: 'tokens' },
        successUrl: `${appUrl}/wallet?purchase=success`,
        cancelUrl: `${appUrl}/wallet?purchase=cancel`,
        customerEmail: s.email,
      });
      await Purchase.updateOne({ _id: purchase._id }, { $set: { providerRef: session.id } });
      logEvent('purchase_checkout_created', { userId: s.uid, purchaseId: String(purchase._id) });
      return NextResponse.json({ ok: true, url: session.url, purchaseId: String(purchase._id) });
    } catch (e) {
      await Purchase.updateOne({ _id: purchase._id }, { $set: { status: 'failed' } });
      logError('purchase_checkout_failed', e, { userId: s.uid });
      return jsonError(502, 'payment provider error');
    }
  }

  // MOCK — no payment provider configured.
  const purchase = await Purchase.create({
    userId: s.uid, packageId: pkg.id, tokens: pkg.tokens, priceCents: pkg.priceCents,
    status: 'completed', provider: 'mock', providerRef: `mock:${Date.now()}`, completedAt: new Date(),
  });
  const { balance, txId } = await credit({
    userId: s.uid, amount: pkg.tokens, type: 'purchase',
    description: `Token vásárlás — ${pkg.label} csomag (${pkg.tokens} token, $${(pkg.priceCents / 100).toFixed(2)}) [MOCK]`,
    ref: { purchaseId: purchase._id },
    idempotencyKey: `purchase:${purchase._id}`,
  });
  logEvent('purchase_mock_completed', { userId: s.uid, purchaseId: String(purchase._id), tokens: pkg.tokens });
  return NextResponse.json({ ok: true, balance, txId, purchaseId: String(purchase._id), mock: true });
}
