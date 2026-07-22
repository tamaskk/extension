// Single source of truth for CRM pipeline status labels (Hungarian).
// Keep the keys in sync with CRM_STATUSES in lib/models.ts.
export const CRM_STATUS_LABELS: Record<string, string> = {
  new: 'új', called: 'felhívva', offer: 'ajánlat kiküldve', won: 'megnyert', lost: 'elveszett',
};

// Client-safe lead response shape (what /api/leads/* returns after masking).
export interface LeadItem {
  id: string;
  name: string;
  category: string;
  rating: number | null;
  reviewCount: number | null;
  city: string;
  leadScore: number | null;
  leadTemperature: string;
  opportunityScore: number | null;
  hasPhone: boolean; hasEmail: boolean; hasWebsite: boolean;
  unlocked: { lead: boolean; contact: boolean };
  // present once unlocked.lead:
  address?: string; mapsUrl?: string; websiteStatus?: string; topPitch?: string;
  aiSummary?: string; aiPainPoints?: string; aiAdvantages?: string; aiPitch?: string;
  // present once unlocked.contact:
  phone?: string; email?: string; website?: string;
  unlockedAt?: string;
}
