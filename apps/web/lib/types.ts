export type WebsiteStatus =
  | 'HAS_WEBSITE' | 'NO_WEBSITE' | 'FACEBOOK_ONLY' | 'INSTAGRAM_ONLY'
  | 'BROKEN' | 'DOMAIN_EXPIRED' | 'NOT_WORKING' | 'DOMAIN_PARKED'
  | 'UNDER_CONSTRUCTION' | 'REDIRECTS';

export type Temperature = 'COLD' | 'WARM' | 'HOT';

export interface Lead {
  placeId?: string;
  cid?: string;
  dedupKey: string;
  name: string;
  category?: string;
  rating?: number | null;
  reviewCount?: number | null;
  phone?: string;
  website?: string;
  email?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  mapsUrl?: string;
  websiteStatus: WebsiteStatus;
  leadScore: number;
  leadTemperature: Temperature;
  opportunityScore: number;
  topPitch?: string;
  checked?: boolean;
  call?: boolean;
  tags?: string[];
  salesStatus?: string;
  salesDate?: string; // YYYY-MM-DD for date-bound stages (callback, follow-up, meeting…)
  notes?: string;     // free-form notes, auto-saved from the detail panel
  notesAt?: string;   // ISO of the last notes edit ('' = none)
  emailSubject?: string; // GPT outreach draft
  emailBody?: string;
  emailAt?: string;
  emailSentAt?: string;  // when the draft was sent via Resend
  emailSentTo?: string;
  smsBody?: string;      // GPT outreach SMS draft
  smsAt?: string;
  emailSearchAt?: string; // last automated contact search
  vapiCalls?: { id: string; at: string; endedReason?: string }[]; // Vapi call history
  hasBookingHint?: boolean | null;
  scrapedAt?: string;
  reviewsCount?: number | null; // how many reviews we scraped & stored
  reviewsScrapedAt?: string;    // ISO when reviews were scraped ('' / undefined = not yet)

  // ── AI insights (generated locally via the Claude CLI, /api/enrich) ──────────
  aiSummary?: string;     // short company summary from data + reviews
  aiPainPoints?: string;  // weaknesses (newline-separated bullets)
  aiAdvantages?: string;  // strengths (newline-separated bullets)
  aiPitch?: string;       // how to sell to them / what to focus on
  aiAt?: string;          // ISO when generated ('' / undefined = not yet)
}

export interface ReviewRow {
  author?: string;
  authorUrl?: string;
  rating?: number | null;
  text?: string;
  relativeTime?: string;
  ownerResponse?: string;
  reviewId?: string;
  scrapedAt?: string;
}

// Full sales pipeline — from first touch to closed/paid.
export const SALES_STATUSES = [
  'New', 'Contacted', 'No answer', 'Callback requested', 'Follow-up', 'Interested', 'Not interested',
  'Meeting needed', 'Meeting scheduled', 'Meeting done',
  'Proposal sent', 'Negotiating', 'Waiting for contract', 'Contract signed',
  'Send invoice', 'Invoice sent', 'Send payment link', 'Payment link sent', 'Awaiting payment',
  'Won / Paid', 'Lost',
];
// chip color per sales stage
export const SALES_COLOR: Record<string, string> = {
  'New': '#64748b', 'Contacted': '#3b82f6', 'No answer': '#94a3b8', 'Callback requested': '#0ea5e9',
  'Follow-up': '#f59e0b', 'Interested': '#06b6d4', 'Not interested': '#475569',
  'Meeting needed': '#eab308', 'Meeting scheduled': '#8b5cf6', 'Meeting done': '#7c3aed',
  'Proposal sent': '#a855f7', 'Negotiating': '#ec4899', 'Waiting for contract': '#d946ef', 'Contract signed': '#10b981',
  'Send invoice': '#f97316', 'Invoice sent': '#fb923c', 'Send payment link': '#f59e0b', 'Payment link sent': '#fbbf24',
  'Awaiting payment': '#eab308', 'Won / Paid': '#22c55e', 'Lost': '#ef4444',
};
// stages that are tied to a date (show a date picker next to the status)
export const SALES_NEEDS_DATE = new Set(['Callback requested', 'Follow-up', 'Meeting needed', 'Meeting scheduled', 'Awaiting payment']);

export interface Project {
  query: string;
  name: string;
  createdAt: string;
  folderId?: string | null;
  records: Record<string, Lead>;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  collapsed: boolean;
  order?: number;
  parentId?: string | null; // null = root; otherwise nested under this folder
  icon?: string; // optional emoji icon
}

/** A Lead decorated with its origin, for cross-project (All leads / duplicates) views. */
// The part of a lead's outreach sequence state the dashboard shows. The full
// subdocument is `seq` in lib/models.ts; absent on a lead that was never enrolled.
export type SeqStatus = 'active' | 'waiting' | 'replied' | 'bounced' | 'finished' | 'stopped' | 'failed' | 'hold';
export interface LeadSeq {
  status?: SeqStatus | '';
  stepId?: string;      // the next step to send
  nextStepAt?: string;  // ISO, when it is due
  offer?: 'ai' | 'social' | '';   // what the second round offers
  offerReasons?: string[];        // why, as short phrases
  offerManual?: boolean;          // chosen by the operator, not by the rule
}

// One email of a sequence. `id` never changes; a lead points at its next step by it.
export interface OutreachStep {
  id: string;
  delayDays: number | null; // days after the step before it; null = not filled in yet
  subject: string;
  body: string;
  sameThread: boolean;
  enabled: boolean;
  variantOf?: string;       // another wording of that step
  weight?: number;
}
export interface OutreachSequenceRow {
  sequenceId: string;
  name: string;
  language: string;
  senderIds: string[];      // empty = every sender
  steps: OutreachStep[];
  stopOnReply: boolean;
  stopOnBounce: boolean;
  enabled: boolean;
  autoFollowUp: boolean;    // false = after the opening email a lead waits until the operator starts the follow-ups
  createdAt: string;
  updatedAt: string;
  errors: string[];         // what keeps it from running; empty = it may run
  activeLeads: number | null; // leads in it right now; null = could not be counted
  sentLast7: number;        // emails it sent in the last seven days
  sentByStep: Record<string, number>; // emails sent so far per step id; a wording variant has its own id
}

export interface WarmupTier { fromDay: number; dailyLimit: number }

// A sender account as the dashboard gets it. The app password is never part of
// it, not even sealed: `hasPassword` only says whether one is stored.
export interface OutreachSenderRow {
  senderId: string;
  label: string;
  fromName: string;
  fromEmail: string;
  language: 'en' | 'hu';
  smtpHost: string; smtpPort: number;
  imapHost: string; imapPort: number;
  authUser: string;
  hasPassword: boolean;
  active: boolean;
  dailyLimit: number;    // the ceiling no warm-up tier can lift
  warmup: { enabled: boolean; tiers: WarmupTier[] };
  firstSendAt: string;   // '' until the first email went out; the warm-up days count from it
  sendDays: number[];    // 1 = Monday ... 7 = Sunday, on the recipient's clock
  windowFrom: number;    // first sending hour on the recipient's clock
  windowTo: number;      // the hour sending stops
  capToday: number;      // what the account may send today (dailyCapFor in lib/warmup.mjs)
  sentToday: number;     // emails sent since midnight in the warm-up time zone
  lastTickAt: string;
  lastCheckedAt: string;
  notes: string;
}

export interface LeadRow extends Lead {
  _project: string;
  _key: string;
  seq?: LeadSeq;
}

// sums of the project counters of one folder (its own projects, not its sub-folders')
export interface FolderAggregate {
  projects: number; zero: number; // zero = projects without a single lead
  total: number; noWebsite: number; hot: number; email: number; emailMiss: number; emailTodo: number;
  reviews: number; reviewsSum: number; ai: number; oppSum: number;
}
// GET /api/sidebar — everything the sidebar shows before a folder is opened
export interface SidebarPayload {
  ok: boolean; error?: string;
  folders: (Folder & { own: FolderAggregate | null; missing: number | null })[];
  ungrouped: FolderAggregate;
  all: FolderAggregate;
  facets: { types: string[]; regions: string[]; countries: [string, number][] };
}

export interface ProjectSummary {
  query: string;
  name: string;
  createdAt: string;
  folderId: string | null;
  total: number;
  noWebsite: number;
  hot: number;
  email: number;
  emailMiss?: number; // website checked, no email found
  emailTodo?: number; // has a real website, no email, website not checked yet
  reviews?: number;
  reviewsSum?: number;
  ai?: number;
  oppSum?: number;
}

export const NO_SITE = new Set<WebsiteStatus>([
  'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION',
]);
