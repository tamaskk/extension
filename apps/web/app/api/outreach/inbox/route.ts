import { dbConnect } from '@/lib/db';
import { OutreachInbox, CORS, json } from '@/lib/models';
import { checkInbox } from '@/lib/inboxWatcher';
import { refuseUnlessOperator } from '@/lib/session';
import { patchSettings } from '@/lib/outreachSettings';

export const runtime = 'nodejs';
export const maxDuration = 60;
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// POST /api/outreach/inbox
// Read one sender mailbox, the one read longest ago, and act on what arrived:
// bounces, replies, stop requests, out-of-office notes. Called by the runner
// tab every few minutes; one mailbox per call, so twenty mailboxes still fit
// the 60 seconds. → { ok, checked, messages, bounces, replies, stops, autoReplies, unmatched, more, reason }
export async function POST(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    return json(await checkInbox());
  } catch (e) {
    // the mail library's message can carry the login name: only ours goes out
    console.error('outreach inbox round failed', e instanceof Error ? e.message.slice(0, 200) : '');
    return json({ ok: false, error: 'The mailbox could not be read. Test the connection of the sender accounts.', reason: 'The mailbox could not be read.' }, { status: 500 });
  }
}

// GET /api/outreach/inbox?show=replies|bounces|unmatched
// What arrived, newest first, for the Replies view: what the person wrote, who
// it is and which step they answered. `unseen` counts the replies nobody has
// looked at yet.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const show = new URL(req.url).searchParams.get('show') || 'replies';
    const match: Record<string, unknown> = show === 'bounces' ? { kind: 'bounce' } : show === 'unmatched' ? { kind: { $in: ['human', 'bounce'] }, dedupKey: { $in: ['', null] }, handledAt: { $gt: '' } } : { kind: 'human' };
    const [rows, unseen, oldestUnseen] = await Promise.all([
      OutreachInbox.find(match).sort({ at: -1 }).limit(200).select('-snippet').lean(),
      OutreachInbox.countDocuments({ kind: 'human', seenAt: '' }),
      OutreachInbox.findOne({ kind: 'human', seenAt: '' }).sort({ at: 1 }).select('at -_id').lean() as Promise<{ at?: string } | null>,
    ]);
    // the text apart, cut to what the list shows: the start of what the person wrote
    const texts = await OutreachInbox.find({ _id: { $in: (rows as { _id: unknown }[]).map((r) => r._id) } }).select('snippet').lean() as { _id: unknown; snippet?: string }[];
    const textOf = new Map(texts.map((t) => [String(t._id), (t.snippet || '').slice(0, 300)]));
    const items = (rows as Record<string, unknown>[]).map(({ _id, ...r }) => ({ id: String(_id), ...r, text: textOf.get(String(_id)) || '' }));
    return json({ ok: true, items, unseen, oldestUnseenAt: oldestUnseen?.at || '' });
  } catch (e) {
    console.error('outreach inbox list failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'The replies could not be loaded.' }, { status: 500 });
  }
}

// PATCH /api/outreach/inbox  { seen: 'all' }
// The operator has read the replies.
export async function PATCH(req: Request) {
  try {
    const refused = await refuseUnlessOperator(req, true);
    if (refused) return refused;
    await dbConnect();
    const b = await req.json().catch(() => ({}));
    if (b?.seen !== 'all') return json({ ok: false, error: 'nothing to do' }, { status: 400 });
    const r = await OutreachInbox.updateMany({ kind: 'human', seenAt: '' }, { $set: { seenAt: new Date().toISOString() } });
    // the day's acknowledgement the campaign gate looks at
    await patchSettings({ repliesReviewedAt: new Date().toISOString() });
    return json({ ok: true, marked: r.modifiedCount || 0 });
  } catch (e) {
    console.error('outreach inbox mark seen failed', e instanceof Error ? e.message : '');
    return json({ ok: false, error: 'That could not be saved.' }, { status: 500 });
  }
}
