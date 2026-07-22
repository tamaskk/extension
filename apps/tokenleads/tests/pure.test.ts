// Pure-function invariants: query building, grant hashing, CSV, rate limiting.
import { describe, it, expect } from 'vitest';
import { buildQuery, queryKey } from '../lib/leads';
import { toCsv } from '../lib/csv';
import { limit, _resetBuckets } from '../lib/rateLimit';
import { verifyStripeSignature } from '../lib/stripe';
import { isDisposableEmail } from '../lib/disposableDomains';
import { createHmac } from 'crypto';

describe('buildQuery', () => {
  it('whitelists enum filters — invalid values are dropped', () => {
    const q = buildQuery({ temperature: 'EVIL"; drop', websiteStatus: 'HACK' });
    expect(q.leadTemperature).toBeUndefined();
    expect(q.websiteStatus).toBeUndefined();
  });

  it('accepts valid enums and numeric filters', () => {
    const q = buildQuery({ temperature: 'HOT', websiteStatus: 'NO_WEBSITE', minRating: 4, minReviews: 25 });
    expect(q.leadTemperature).toBe('HOT');
    expect(q.websiteStatus).toBe('NO_WEBSITE');
    expect(q.rating).toEqual({ $gte: 4 });
    expect(q.reviewCount).toEqual({ $gte: 25 });
  });

  it('escapes regex metacharacters in free-text filters', () => {
    const q = buildQuery({ q: 'a.b*c(d' });
    const rx = (q.$and as { $or: { name: RegExp }[] }[])[0].$or[0].name;
    expect(rx.test('a.b*c(d')).toBe(true);
    expect(rx.test('aXbYcZd')).toBe(false);
  });
});

describe('queryKey', () => {
  it('is stable regardless of trailing whitespace and case', () => {
    expect(queryKey({ q: ' Pizza ', city: 'Houston, TX' })).toBe(queryKey({ q: 'pizza', city: 'houston, tx' }));
  });
  it('differs by page and by filters', () => {
    expect(queryKey({ q: 'a', page: 1 })).not.toBe(queryKey({ q: 'a', page: 2 }));
    expect(queryKey({ q: 'a' })).not.toBe(queryKey({ q: 'a', temperature: 'HOT' }));
  });
});

describe('toCsv', () => {
  it('escapes quotes, commas and newlines per RFC4180', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"\nline2']]);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"he said ""hi""\nline2"');
  });
  it('starts with a UTF-8 BOM for Excel', () => {
    expect(toCsv(['a'], []).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('rateLimit', () => {
  it('enforces the window and reports retryAfter', () => {
    _resetBuckets();
    for (let i = 0; i < 3; i++) expect(limit('k', 3, 60_000).ok).toBe(true);
    const denied = limit('k', 3, 60_000);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });
  it('isolates keys', () => {
    _resetBuckets();
    limit('a', 1, 60_000);
    expect(limit('b', 1, 60_000).ok).toBe(true);
  });
});

describe('verifyStripeSignature', () => {
  it('accepts a valid signature and rejects tampering', () => {
    const secret = 'whsec_test';
    const body = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret)).toBe(true);
    expect(verifyStripeSignature(body + 'x', `t=${t},v1=${v1}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret)).toBe(false);
  });
  it('rejects stale timestamps', () => {
    const secret = 'whsec_test';
    const body = '{}';
    const t = Math.floor(Date.now() / 1000) - 3600;
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret)).toBe(false);
  });
});

describe('isDisposableEmail', () => {
  it('flags known burner domains, passes real ones', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@YOPmail.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
  });
});
