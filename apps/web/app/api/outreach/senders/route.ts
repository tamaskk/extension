import { randomBytes } from 'node:crypto';
import { dbConnect } from '@/lib/db';
import { OutreachSender, CORS, json } from '@/lib/models';
import { logActivity } from '@/lib/activity';
import { listSenders } from '@/lib/outreachSenders';
import { cleanSender } from '@/lib/outreachSenderRules.mjs';
import { seal } from '@/lib/secretBox.mjs';
import { refuseUnlessOperator } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// The app password is typed with or without the spaces Google shows it with.
const cleanPassword = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '') : '');

// Seal the password, or say in our own words why that is not possible. The
// library's message stays on the server.
function sealPassword(password: string): { sealed: string } | { error: string } {
  try {
    return { sealed: seal(password) };
  } catch (e) {
    console.error('outreach sender: the password could not be sealed', e instanceof Error ? e.message : '');
    return { error: 'The password cannot be stored: OUTREACH_SECRET_KEY is missing or malformed on the server.' };
  }
}

// GET /api/outreach/senders
// The accounts with today's numbers. Never the password, not even sealed.
export async function GET(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, false);
    if (refused) return refused;
    return json({ ok: true, senders: await listSenders() });
  } catch (e) {
    console.error('outreach senders list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The sender accounts could not be loaded.' }, { status: 500 });
  }
}

// POST /api/outreach/senders  { label, fromName, fromEmail, language, password, ... }
// A new account. It starts switched off, on the default warm-up tiers; the
// warm-up days count from its first successful send, not from today.
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const { value, errors } = cleanSender(b, true);
    const password = cleanPassword(b?.password);
    if (!password) errors.push('The app password is missing.');
    if (errors.length) return json({ ok: false, error: errors.join(' ') }, { status: 400 });
    if (await OutreachSender.exists({ fromEmail: value.fromEmail })) return json({ ok: false, error: 'An account with this From address already exists.' }, { status: 400 });

    const sealed = sealPassword(password);
    if ('error' in sealed) return json({ ok: false, error: sealed.error }, { status: 500 });
    const now = new Date().toISOString();
    const senderId = randomBytes(6).toString('hex');
    await OutreachSender.create({ ...value, active: false, senderId, authSecret: sealed.sealed, firstSendAt: '', createdAt: now, updatedAt: now });
    await logActivity({ type: 'outreach.sender', n: 1, title: `Sender account added: ${value.label} (${value.fromEmail})`, data: { senderId, fromEmail: value.fromEmail, language: value.language } });
    return json({ ok: true, senderId });
  } catch (e) {
    console.error('outreach sender create failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The account could not be saved.' }, { status: 500 });
  }
}

// PATCH /api/outreach/senders  { senderId, ...fields, password?, restartWarmup? }
// Only the fields that are sent change. An empty or missing password keeps the
// stored one: otherwise every save of the form would wipe it.
export async function PATCH(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    const senderId = String(b?.senderId || '');
    const current = await OutreachSender.findOne({ senderId }).select('+authSecret label fromEmail active').lean() as { label?: string; fromEmail?: string; active?: boolean; authSecret?: string } | null;
    if (!senderId || !current) return json({ ok: false, error: 'The account was not found.' }, { status: 404 });

    const { value, errors } = cleanSender(b, false);
    if (errors.length) return json({ ok: false, error: errors.join(' ') }, { status: 400 });
    const set: Record<string, unknown> = { ...value };
    if (set.authUser === '') delete set.authUser; // an emptied login field keeps the stored one
    if (value.fromEmail && value.fromEmail !== current.fromEmail && await OutreachSender.exists({ fromEmail: value.fromEmail })) {
      return json({ ok: false, error: 'An account with this From address already exists.' }, { status: 400 });
    }

    const password = cleanPassword(b?.password);
    if (password) {
      const sealed = sealPassword(password);
      if ('error' in sealed) return json({ ok: false, error: sealed.error }, { status: 500 });
      set.authSecret = sealed.sealed;
    }
    if (value.active === true && !password && !current.authSecret) return json({ ok: false, error: 'Store an app password before switching the account on.' }, { status: 400 });
    // back to the first tier; the days count again from the next email that goes out
    if (b?.restartWarmup === true) set.firstSendAt = '';
    if (!Object.keys(set).length) return json({ ok: true });

    set.updatedAt = new Date().toISOString();
    await OutreachSender.updateOne({ senderId }, { $set: set });
    // field names only: a value could be the password one day, a name cannot
    const changed = Object.keys(set).filter((k) => k !== 'updatedAt' && k !== 'authSecret');
    const what = [
      value.active === true && !current.active ? 'switched on' : '',
      value.active === false && current.active ? 'switched off' : '',
      password ? 'password replaced' : '',
      b?.restartWarmup === true ? 'warm-up restarted' : '',
    ].filter(Boolean).join(', ') || 'edited';
    await logActivity({ type: 'outreach.sender', n: 1, title: `Sender account ${what}: ${value.label || current.label} (${value.fromEmail || current.fromEmail})`, data: { senderId, changed, passwordReplaced: !!password } });
    return json({ ok: true });
  } catch (e) {
    console.error('outreach sender update failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The account could not be saved.' }, { status: 500 });
  }
}
