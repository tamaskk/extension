// Which company domains have a running sequence right now. Server code.
//
// One company can be several leads (several branches or addresses at one
// domain), and only one of them may be in a sequence at a time: the rule is in
// lib/dispatchPlan.mjs (pickOnePerDomain, domainHeldByAnother). This file only
// fetches the set that rule needs.
import { dbConnect } from '@/lib/db';
import { Lead } from '@/lib/models';
import { companyDomainOf } from '@/lib/dispatchPlan.mjs';

// Map(domain → dedupKeys of the leads with an active sequence at that domain).
// Addresses at mailbox providers are left out: they never block each other.
//
// Reads only the leads in an active sequence, through the partial index
// `gl_seq_due`. The hint is deliberate: without that index this would be a scan
// of every lead, and failing is better than that.
export async function activeCompanyDomains(): Promise<Map<string, string[]>> {
  await dbConnect();
  const rows = await Lead.find({ 'seq.status': 'active' }).hint('gl_seq_due').select('dedupKey seq.to -_id').lean() as unknown as { dedupKey: string; seq?: { to?: string } }[];
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const domain = companyDomainOf(r.seq?.to || '');
    if (!domain) continue;
    const keys = out.get(domain);
    if (keys) keys.push(r.dedupKey); else out.set(domain, [r.dedupKey]);
  }
  return out;
}
