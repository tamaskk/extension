// Sends the companies the operator picked on to Melodia's company intake.
// Server code: the key is read here and never leaves the server. Which leads go and in what
// shape is decided by lib/melodiaPlan.mjs.
import { logActivity } from '@/lib/activity';
import { MELODIA_BATCH } from '@/lib/melodiaPlan.mjs';

const ENDPOINT = 'https://melodia-kt.vercel.app/api/bot/companies';
const TIMEOUT_MS = 20_000;

export interface MelodiaCompany { company: string; website?: string; country: string; source: string; industry?: string; email?: string; otherEmails?: string[] }

export interface MelodiaOutcome { inserted: number; skipped: number; failed: number; problems: string[] }

// Sends the companies in batches, one after the other, as Melodia asks. Never
// throws: what failed is counted and named. Without MELODIA_API_KEY → null. A
// company Melodia already has comes back as skipped, so sending one twice does no harm.
export async function pushToMelodia(companies: MelodiaCompany[]): Promise<MelodiaOutcome | null> {
  const key = process.env.MELODIA_API_KEY;
  if (!key) return null;
  if (!companies.length) return { inserted: 0, skipped: 0, failed: 0, problems: [] };
  let inserted = 0, skipped = 0, failed = 0;
  const problems: string[] = [];
  for (let i = 0; i < companies.length; i += MELODIA_BATCH) {
    const batch = companies.slice(i, i + MELODIA_BATCH);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ companies: batch }), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const r = await res.json().catch(() => null) as { inserted?: number; skipped?: unknown[]; errors?: { company?: string; field?: string; message?: string }[] } | null;
      // 200 can still hold rows it refused; 422 is a batch where every row was refused
      if (!res.ok && res.status !== 422) { failed += batch.length; problems.push(`HTTP ${res.status}`); continue; }
      inserted += Number(r?.inserted) || 0;
      skipped += Array.isArray(r?.skipped) ? r.skipped.length : 0;
      for (const e of r?.errors || []) { failed++; if (problems.length < 5) problems.push(`${e.company || '?'}: ${e.field || ''} ${e.message || ''}`.trim()); }
    } catch (e) {
      failed += batch.length;
      problems.push(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
  }
  if (failed) console.error('melodia push: some companies were not taken', problems.join(' | '));
  await logActivity({
    type: 'melodia.push', n: companies.length, source: 'system',
    title: `Melodia: ${inserted} IT ${inserted === 1 ? 'company' : 'companies'} added, ${skipped} already there${failed ? `, ${failed} not taken` : ''}`,
    data: { inserted, skipped, failed, problems },
  });
  return { inserted, skipped, failed, problems };
}
