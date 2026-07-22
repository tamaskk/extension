import { Setting } from './models';
import { dbConnect } from './db';
import { Pricing, PRICING_DEFAULTS } from './pricingShared';

export type { Pricing };
export { PRICING_DEFAULTS, PACKAGES, PLANS } from './pricingShared';

// 60s in-memory cache — admin price edits go live within a minute.
let cache: { at: number; value: Pricing } | null = null;

export async function getPricing(): Promise<Pricing> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  await dbConnect();
  const rows = await Setting.find({ key: { $in: Object.keys(PRICING_DEFAULTS) } }).lean();
  const value = { ...PRICING_DEFAULTS };
  for (const r of rows as unknown as { key: keyof Pricing; value: number }[]) {
    if (r.key in value && Number.isFinite(r.value) && r.value >= 0) value[r.key] = Math.floor(r.value);
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setPricing(patch: Partial<Pricing>): Promise<Pricing> {
  await dbConnect();
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in PRICING_DEFAULTS)) continue;
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value) || value < 0) continue;
    await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  }
  cache = null;
  return getPricing();
}
