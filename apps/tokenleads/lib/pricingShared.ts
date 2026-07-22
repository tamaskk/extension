// Client-safe pricing constants — no mongoose/db imports here.
export interface Pricing {
  SIGNUP_BONUS: number;          // granted at EMAIL VERIFICATION, not registration
  SEARCH_COST: number;
  LEAD_UNLOCK_COST: number;
  CONTACT_UNLOCK_COST: number;
  BULK_DISCOUNT_PCT: number;     // % off when unlocking a whole page at once
  EXPORT_PAGE_COST: number;      // CSV export of one (paid) search page
  AI_EMAIL_COST: number;         // AI outreach draft per lead
  REFERRAL_BONUS: number;        // both sides, on referee verification
  DAILY_SEARCH_QUOTA: number;    // paid search pages / user / day
  LOW_BALANCE_THRESHOLD: number; // UI warning below this
}

export const PRICING_DEFAULTS: Pricing = {
  SIGNUP_BONUS: 25,
  SEARCH_COST: 1,
  LEAD_UNLOCK_COST: 2,
  CONTACT_UNLOCK_COST: 5,
  BULK_DISCOUNT_PCT: 20,
  EXPORT_PAGE_COST: 5,
  AI_EMAIL_COST: 8,
  REFERRAL_BONUS: 15,
  DAILY_SEARCH_QUOTA: 200,
  LOW_BALANCE_THRESHOLD: 5,
};

// Token packages users can buy (Stripe Checkout when configured, mock otherwise).
export const PACKAGES = [
  { id: 'starter', tokens: 100, priceCents: 900, label: 'Starter' },
  { id: 'growth', tokens: 500, priceCents: 3900, label: 'Growth' },
  { id: 'scale', tokens: 2000, priceCents: 12900, label: 'Scale' },
] as const;

// Monthly subscriptions — tokens granted every period.
export const PLANS = [
  { id: 'pro', label: 'Pro', priceCents: 2900, tokensPerMonth: 400 },
  { id: 'business', label: 'Business', priceCents: 9900, tokensPerMonth: 1600 },
] as const;
export type PlanId = typeof PLANS[number]['id'];
