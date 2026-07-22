// Structured logging + optional Sentry error shipping (no SDK — envelope API).
// Without SENTRY_DSN everything still lands on stdout as JSON lines, which is
// what Vercel/Docker log collectors expect.

interface LogCtx { [k: string]: unknown; }

export function logEvent(event: string, ctx: LogCtx = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...ctx }));
}

export function logError(event: string, err: unknown, ctx: LogCtx = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(JSON.stringify({ t: new Date().toISOString(), event, error: message, ...ctx }));
  void shipToSentry(event, message, stack, ctx);
}

// Minimal Sentry envelope — fire-and-forget, never throws into the caller.
async function shipToSentry(event: string, message: string, stack: string | undefined, ctx: LogCtx) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if (!m) return;
    const [, key, host, projectId] = m;
    const payload = {
      message: `${event}: ${message}`,
      level: 'error',
      platform: 'node',
      extra: { ...ctx, stack },
      timestamp: Date.now() / 1000,
    };
    const envelope =
      JSON.stringify({ sent_at: new Date().toISOString() }) + '\n' +
      JSON.stringify({ type: 'event' }) + '\n' +
      JSON.stringify(payload) + '\n';
    await fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: { 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}` },
      body: envelope,
    });
  } catch { /* monitoring must never break the request */ }
}
