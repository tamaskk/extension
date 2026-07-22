import { Schema, model, models, Types } from 'mongoose';

// ── User ─────────────────────────────────────────────────────────────────
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  emailVerifiedAt: { type: Date, default: null },
  verifyToken: { type: String, default: null, index: true },
  verifyTokenExp: { type: Date, default: null },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: Types.ObjectId, default: null },     // userId of the referrer
  referralRewardedAt: { type: Date, default: null },
  onboardedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

// ── Wallet — 1:1 user, cached balance; the ledger is the source of truth ─
const WalletSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, unique: true, index: true },
  balance: { type: Number, required: true, default: 0 },        // whole tokens, never float
  lifetimeGranted: { type: Number, default: 0 },
  lifetimeSpent: { type: Number, default: 0 },
  updatedAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

// ── TokenTransaction — append-only ledger, never updated or deleted ──────
export const TX_TYPES = [
  'signup_bonus', 'purchase', 'spend_search', 'spend_lead_unlock', 'spend_contact_unlock',
  'spend_bulk_unlock', 'spend_export', 'spend_ai',
  'referral_bonus', 'promo_credit', 'subscription_grant',
  'admin_adjust', 'refund',
] as const;
export type TxType = typeof TX_TYPES[number];

const TokenTransactionSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, index: true },
  type: { type: String, enum: TX_TYPES, required: true },
  amount: { type: Number, required: true },       // signed: + credit, − debit
  balanceAfter: { type: Number, required: true },
  description: { type: String, default: '' },     // denormalized, human-readable
  ref: {
    leadId: { type: Types.ObjectId, default: null },
    query: { type: String, default: '' },
    purchaseId: { type: Types.ObjectId, default: null },
  },
  idempotencyKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: () => new Date(), index: true },
}, { versionKey: false });
TokenTransactionSchema.index({ userId: 1, createdAt: -1 });

// ── Unlock — entitlement: once paid, visible forever ─────────────────────
// `snapshot` preserves the lead as it was at unlock time, so a later delete
// in the source DB can't take away what the user paid for.
const UnlockSchema = new Schema({
  userId: { type: Types.ObjectId, required: true },
  leadId: { type: Types.ObjectId, required: true },
  scope: { type: String, enum: ['lead', 'contact'], required: true },
  txId: { type: Types.ObjectId, default: null },
  snapshot: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
UnlockSchema.index({ userId: 1, leadId: 1, scope: 1 }, { unique: true });
UnlockSchema.index({ userId: 1, createdAt: -1 });

// ── SearchGrant — a paid search page, re-fetchable free for 24h ──────────
const SearchGrantSchema = new Schema({
  userId: { type: Types.ObjectId, required: true },
  queryHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL
}, { versionKey: false });
SearchGrantSchema.index({ userId: 1, queryHash: 1 }, { unique: true });

// ── Purchase — token top-up intent ───────────────────────────────────────
const PurchaseSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, index: true },
  packageId: { type: String, required: true },
  tokens: { type: Number, required: true },
  priceCents: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  provider: { type: String, enum: ['mock', 'stripe'], default: 'mock' },
  providerRef: { type: String, default: '', index: true },
  createdAt: { type: Date, default: () => new Date() },
  completedAt: { type: Date, default: null },
}, { versionKey: false });

// ── Setting — runtime-tunable numbers (prices, quotas) ───────────────────
const SettingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true },
}, { versionKey: false });

// ── SavedSearch — saved filter combos, optional email alerts (lead radar) ─
// lastMaxId: ObjectIds are monotonic — "new since last run" = _id > lastMaxId.
const SavedSearchSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, index: true },
  name: { type: String, required: true },
  filters: { type: Schema.Types.Mixed, required: true },
  queryKey: { type: String, required: true },
  alert: { type: String, enum: ['off', 'daily', 'weekly'], default: 'off' },
  lastMaxId: { type: Types.ObjectId, default: null },
  lastRunAt: { type: Date, default: null },
  lastCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
SavedSearchSchema.index({ userId: 1, queryKey: 1 }, { unique: true });

// ── LeadMeta — mini-CRM on unlocked leads ────────────────────────────────
export const CRM_STATUSES = ['new', 'called', 'offer', 'won', 'lost'] as const;
const LeadMetaSchema = new Schema({
  userId: { type: Types.ObjectId, required: true },
  leadId: { type: Types.ObjectId, required: true },
  note: { type: String, default: '', maxlength: 5000 },
  status: { type: String, enum: CRM_STATUSES, default: 'new' },
  tags: { type: [String], default: [] },
  updatedAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
LeadMetaSchema.index({ userId: 1, leadId: 1 }, { unique: true });

// ── Report — "bad contact data" complaints → admin refund queue ──────────
const ReportSchema = new Schema({
  userId: { type: Types.ObjectId, required: true },
  leadId: { type: Types.ObjectId, required: true },
  reason: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'refunded', 'rejected'], default: 'pending', index: true },
  refundTxId: { type: Types.ObjectId, default: null },
  resolvedBy: { type: String, default: '' },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
ReportSchema.index({ userId: 1, leadId: 1 }, { unique: true }); // one report per lead per user

// ── PromoCode ────────────────────────────────────────────────────────────
const PromoCodeSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  tokens: { type: Number, required: true },
  maxUses: { type: Number, required: true },
  usedCount: { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

const PromoRedemptionSchema = new Schema({
  code: { type: String, required: true },
  userId: { type: Types.ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
PromoRedemptionSchema.index({ code: 1, userId: 1 }, { unique: true });

// ── ApiKey — developer access, same token economy over Bearer auth ───────
const ApiKeySchema = new Schema({
  userId: { type: Types.ObjectId, required: true, index: true },
  name: { type: String, default: 'API kulcs' },
  prefix: { type: String, required: true },          // tl_live_ab12… (first 12 chars, display)
  keyHash: { type: String, required: true, unique: true }, // sha256 of the full key
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

// ── Subscription — monthly token allowance ───────────────────────────────
const SubscriptionSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, unique: true },
  plan: { type: String, enum: ['pro', 'business'], required: true },
  status: { type: String, enum: ['active', 'canceled', 'past_due'], default: 'active' },
  provider: { type: String, enum: ['mock', 'stripe'], default: 'mock' },
  providerRef: { type: String, default: '' },
  currentPeriodEnd: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
  canceledAt: { type: Date, default: null },
}, { versionKey: false });

// ── Outbox — every email; in dev mode this IS the inbox (admin can read) ─
const OutboxSchema = new Schema({
  to: { type: String, required: true },
  subject: { type: String, required: true },
  html: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'dev', 'failed'], required: true },
  provider: { type: String, default: 'dev' },
  error: { type: String, default: '' },
  createdAt: { type: Date, default: () => new Date(), index: true },
}, { versionKey: false });

// ── UsageCounter — persisted daily quotas (search pages, registrations/IP)
const UsageCounterSchema = new Schema({
  key: { type: String, required: true },   // e.g. "search:<uid>" or "reg:<ip>"
  day: { type: String, required: true },   // YYYY-MM-DD
  n: { type: Number, default: 0 },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 3 * 86400_000), index: { expires: 0 } },
}, { versionKey: false });
UsageCounterSchema.index({ key: 1, day: 1 }, { unique: true });

// ── FacetsCache — materialized dropdown facets (cron-refreshed) ──────────
const FacetsCacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, required: true },
}, { versionKey: false });

// ── Reconciliation — ledger↔wallet integrity check results ───────────────
const ReconciliationSchema = new Schema({
  ranAt: { type: Date, required: true },
  checked: { type: Number, required: true },
  mismatches: { type: [Schema.Types.Mixed], default: [] },
  fixed: { type: Number, default: 0 },
}, { versionKey: false });

// ── AiDraft — generated outreach emails (history) ────────────────────────
const AiDraftSchema = new Schema({
  userId: { type: Types.ObjectId, required: true, index: true },
  leadId: { type: Types.ObjectId, required: true },
  input: { type: Schema.Types.Mixed, default: {} },
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  source: { type: String, enum: ['ai', 'template'], required: true },
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

export const User = models.User || model('User', UserSchema);
export const Wallet = models.Wallet || model('Wallet', WalletSchema);
export const TokenTransaction = models.TokenTransaction || model('TokenTransaction', TokenTransactionSchema);
export const Unlock = models.Unlock || model('Unlock', UnlockSchema);
export const SearchGrant = models.SearchGrant || model('SearchGrant', SearchGrantSchema);
export const Purchase = models.Purchase || model('Purchase', PurchaseSchema);
export const Setting = models.Setting || model('Setting', SettingSchema);
export const SavedSearch = models.SavedSearch || model('SavedSearch', SavedSearchSchema);
export const LeadMeta = models.LeadMeta || model('LeadMeta', LeadMetaSchema);
export const Report = models.Report || model('Report', ReportSchema);
export const PromoCode = models.PromoCode || model('PromoCode', PromoCodeSchema);
export const PromoRedemption = models.PromoRedemption || model('PromoRedemption', PromoRedemptionSchema);
export const ApiKey = models.ApiKey || model('ApiKey', ApiKeySchema);
export const Subscription = models.Subscription || model('Subscription', SubscriptionSchema);
export const Outbox = models.Outbox || model('Outbox', OutboxSchema);
export const UsageCounter = models.UsageCounter || model('UsageCounter', UsageCounterSchema);
export const FacetsCache = models.FacetsCache || model('FacetsCache', FacetsCacheSchema);
export const Reconciliation = models.Reconciliation || model('Reconciliation', ReconciliationSchema);
export const AiDraft = models.AiDraft || model('AiDraft', AiDraftSchema);
