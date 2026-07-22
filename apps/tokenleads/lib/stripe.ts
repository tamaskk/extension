// Stripe over plain REST — no SDK dependency. When STRIPE_SECRET_KEY is not
// configured, callers fall back to the mock flow (same purchase state machine).
import { createHmac, timingSafeEqual } from 'crypto';

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Flattens {a: {b: 'x'}} → "a[b]=x" the way Stripe's form encoding expects.
function formEncode(obj: Record<string, unknown>, prefix = ''): string[] {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) pairs.push(...formEncode(v as Record<string, unknown>, key));
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') pairs.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
      else pairs.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return pairs;
}

export async function stripeApi(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe not configured');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(params).join('&'),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe ${res.status}: ${data?.error?.message || 'unknown'}`);
  return data;
}

export interface CheckoutOpts {
  mode: 'payment' | 'subscription';
  name: string;
  priceCents: number;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export async function createCheckoutSession(o: CheckoutOpts): Promise<{ id: string; url: string }> {
  const priceData: Record<string, unknown> = {
    currency: 'usd',
    product_data: { name: o.name },
    unit_amount: o.priceCents,
    ...(o.mode === 'subscription' ? { recurring: { interval: 'month' } } : {}),
  };
  const session = await stripeApi('checkout/sessions', {
    mode: o.mode,
    line_items: [{ price_data: priceData, quantity: 1 }],
    metadata: o.metadata,
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    ...(o.customerEmail ? { customer_email: o.customerEmail } : {}),
  });
  return { id: String(session.id), url: String(session.url) };
}

// Stripe-Signature: t=<ts>,v1=<hmac>. HMAC-SHA256 over `${t}.${rawBody}`.
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t; const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}
