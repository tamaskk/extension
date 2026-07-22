import { Schema, model, models } from 'mongoose';

// Minimal mirror of apps/web's Lead model — only the fields the stats
// aggregation touches. Reads the same `leads` collection.
const LeadSchema = new Schema({
  project: String,
  dedupKey: String,
  website: String,
  websiteStatus: String,
  leadTemperature: String,
}, { versionKey: false });

export const Lead = models.Lead || model('Lead', LeadSchema);

// websiteStatus values that count as "no usable website" (same list as apps/web)
export const NO_SITE = ['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING'];
