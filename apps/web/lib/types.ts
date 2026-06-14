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
  hasBookingHint?: boolean | null;
  scrapedAt?: string;
}

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
