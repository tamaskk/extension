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
  hasBookingHint?: boolean | null;
  scrapedAt?: string;
  reviewsCount?: number | null; // how many reviews we scraped & stored
  reviewsScrapedAt?: string;    // ISO when reviews were scraped ('' / undefined = not yet)
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
export interface LeadRow extends Lead {
  _project: string;
  _key: string;
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
  oppSum?: number;
}

export const NO_SITE = new Set<WebsiteStatus>([
  'NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING',
]);
