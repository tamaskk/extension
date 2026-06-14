export * from './types';
export * from './leadScore';
export * from './websiteOpportunity';
export * from './websiteStatus';

import type { BusinessSignals } from './types';
import { computeLeadScore, DEFAULT_LEAD_WEIGHTS, type LeadScoreWeights } from './leadScore';
import {
  computeOpportunityScore,
  DEFAULT_OPPORTUNITY_WEIGHTS,
  type OpportunityWeights,
} from './websiteOpportunity';

/**
 * One call to produce everything the Business row needs: lead score + temperature,
 * the website opportunity score, and the persisted breakdown/signals JSON.
 */
export function scoreBusiness(
  signals: BusinessSignals,
  opts: { lead?: LeadScoreWeights; opportunity?: OpportunityWeights } = {},
) {
  const lead = computeLeadScore(signals, opts.lead ?? DEFAULT_LEAD_WEIGHTS);
  const opportunity = computeOpportunityScore(signals, opts.opportunity ?? DEFAULT_OPPORTUNITY_WEIGHTS);
  return {
    leadScore: lead.score,
    leadTemperature: lead.temperature,
    opportunityScore: opportunity.score,
    scoreBreakdown: lead.breakdown,
    opportunitySignals: { breakdown: opportunity.breakdown, pitches: opportunity.pitches },
  };
}
