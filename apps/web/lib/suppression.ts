// The suppression list: who must never be written to again, in any sequence,
// from any sender. Server code.
//
// It is a collection of its own and not a field on the lead, because it has to
// outlive the lead: a lead can be deleted and scraped again, and a later
// enrolment into another sequence must still leave that person out.
//
// A row is either one address (`email`, `domain` empty) or a whole company
// domain (`email` is "@domain", `domain` is set). Nothing in the code deletes a
// row except unsuppress(), which is for the operator's own hand only.
import { dbConnect } from '@/lib/db';
import { Suppression } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { domainRowKey, isCommonProvider, lookupKeys, normalizeDomain } from '@/lib/suppressionRules.mjs';

export type SuppressReason = 'stop' | 'hard_bounce' | 'complaint' | 'manual' | 'import';
// added: a new row was written. Otherwise `why` says what happened instead.
export interface SuppressResult { added: boolean; why?: 'exists' | 'invalid' | 'common_provider' }

// May this address be written to? true = no.
// Throws when the database cannot answer, and the caller must let that stop the
// send: never turn the error into `false`. A skipped email is cheap; an email
// to someone who asked not to be written to is not. An address that cannot be
// read counts as suppressed for the same reason.
export async function isSuppressed(email: string, domain?: string): Promise<boolean> {
  const keys = lookupKeys(email, domain);
  if (!keys.email) return true;
  await dbConnect();
  const or: Record<string, string>[] = [{ email: keys.email }];
  if (keys.domain) or.push({ domain: keys.domain });
  return !!(await Suppression.exists({ $or: or }));
}

// Block one address. An existing row is left as it is: the first reason stays.
export async function suppress(email: string, reason: SuppressReason, source: string, note = ''): Promise<SuppressResult> {
  const key = lookupKeys(email).email;
  if (!key) return { added: false, why: 'invalid' };
  await dbConnect();
  const r = await Suppression.updateOne(
    { email: key },
    { $setOnInsert: { email: key, domain: '', reason, source: String(source || ''), note: String(note || ''), createdAt: new Date().toISOString() } },
    { upsert: true },
  );
  if (!r.upsertedCount) return { added: false, why: 'exists' };
  await logActivity({ type: 'outreach.suppress', n: 1, title: `Suppressed ${key} (${reason})`, data: { email: key, reason, source, note }, source: 'system' });
  return { added: true };
}

// Block every address of a company domain. Refused for mailbox providers.
export async function suppressDomain(domain: string, reason: SuppressReason, source: string): Promise<SuppressResult> {
  const d = normalizeDomain(domain);
  if (!d) return { added: false, why: 'invalid' };
  if (isCommonProvider(d)) return { added: false, why: 'common_provider' };
  await dbConnect();
  const r = await Suppression.updateOne(
    { email: domainRowKey(d) },
    { $setOnInsert: { email: domainRowKey(d), domain: d, reason, source: String(source || ''), note: '', createdAt: new Date().toISOString() } },
    { upsert: true },
  );
  if (!r.upsertedCount) return { added: false, why: 'exists' };
  await logActivity({ type: 'outreach.suppress', n: 1, title: `Suppressed the whole domain ${d} (${reason})`, data: { domain: d, reason, source }, source: 'system' });
  return { added: true };
}

// Lift a block: one address, or a whole domain when a domain is given. Only for
// an action the operator takes by hand, when the person asked for it. Never
// call this from a sequence, the watcher or any other automatic path.
export async function unsuppress(emailOrDomain: string): Promise<{ removed: boolean }> {
  const key = String(emailOrDomain || '').includes('@') && !String(emailOrDomain).trim().startsWith('@')
    ? lookupKeys(emailOrDomain).email
    : domainRowKey(emailOrDomain);
  if (!key) return { removed: false };
  await dbConnect();
  const gone = await Suppression.findOneAndDelete({ email: key }).lean() as { reason?: string; source?: string; createdAt?: string } | null;
  if (!gone) return { removed: false };
  await logActivity({ type: 'outreach.suppress', n: 1, title: `Suppression lifted by hand: ${key}`, data: { lifted: key, reason: gone.reason, source: gone.source, suppressedAt: gone.createdAt }, source: 'web' });
  return { removed: true };
}
