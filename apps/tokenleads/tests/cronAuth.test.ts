// Cron guard: open without a secret only outside production.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkCron } from '../lib/cronAuth';

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/facets', auth ? { headers: { authorization: auth } } : undefined);

afterEach(() => { vi.unstubAllEnvs(); });

describe('checkCron', () => {
  it('rejects every request in production when CRON_SECRET is unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');
    expect(checkCron(req())?.status).toBe(503);
    expect(checkCron(req('Bearer '))?.status).toBe(503);
    expect(checkCron(req('Bearer undefined'))?.status).toBe(503);
  });

  it('allows requests outside production when CRON_SECRET is unset', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', '');
    expect(checkCron(req())).toBeNull();
  });

  it('requires the bearer secret when CRON_SECRET is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(checkCron(req('Bearer s3cret'))).toBeNull();
    expect(checkCron(req('Bearer wrong'))?.status).toBe(401);
    expect(checkCron(req())?.status).toBe(401);
  });
});
