// Does a domain take mail at all? One DNS question per domain, remembered.
// Server code, asked at enrolment, never during a send: the send round has no
// time to wait for DNS.
//
// It says nothing about whether the MAILBOX exists, only whether the domain
// receives mail. A domain without an MX record is a certain bounce, and this is
// the cheapest cleaning there is. What still bounces is measured by the bounce
// handling and caught by the suppression list.
import { resolveMx } from 'node:dns/promises';
import { isCommonProvider } from '@/lib/suppressionRules.mjs';

// domain → true (takes mail), false (certainly does not). A domain that could
// not be asked (a timeout, a failing resolver) is not remembered and not held back.
const known = new Map<string, boolean>();

async function ask(domain: string): Promise<boolean | undefined> {
  if (isCommonProvider(domain)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 3000); }),
    ]);
    return records.some((r) => r.exchange && r.exchange !== '.');
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
    // the domain does not exist, or exists and has no MX record: certain
    if (code === 'ENOTFOUND' || code === 'ENODATA') return false;
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// → has(domain): false only when the domain certainly takes no mail; true or
// undefined otherwise. Asks up to 50 domains at a time.
export async function mxLookup(domains: string[]): Promise<(domain: string) => boolean | undefined> {
  const todo = [...new Set(domains.map((d) => d.toLowerCase()).filter(Boolean))].filter((d) => !known.has(d));
  // The whole lookup has a deadline: it runs inside an enrolment call that has
  // 60 seconds in all. A domain that was not reached in time is simply not held back.
  const deadline = Date.now() + 20_000;
  for (let i = 0; i < todo.length && Date.now() < deadline; i += 50) {
    await Promise.all(todo.slice(i, i + 50).map(async (d) => {
      const answer = await ask(d);
      if (answer !== undefined) known.set(d, answer);
    }));
  }
  return (domain) => known.get(String(domain).toLowerCase());
}
