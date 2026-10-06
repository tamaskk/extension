// Gathers what the campaign gate needs to know and asks it. Server code.
//
// The rule itself is pure (lib/campaignGate.mjs). This file only reads: the
// switched-on senders with their limits of today and tomorrow, the last seven
// days' rates, the values the operator entered by hand, and the send loop's
// heartbeat. The send round calls it first, on every call; the Control tab
// shows the same answer.
import { dbConnect } from '@/lib/db';
import { OutreachInbox, OutreachSender } from '@/lib/models';
import { lastSentBeforeToday, outcomeCounts, sentTodayBySender } from '@/lib/outreachSends';
import { readSettings } from '@/lib/outreachSettings';
import type { OutreachSettings } from '@/lib/outreachSettings';
import { campaignGate } from '@/lib/campaignGate.mjs';
import { describeWarmup, warmupStatus } from '@/lib/warmup.mjs';
import { footerFor } from '@/lib/outreachFooter.mjs';
import { MIN_SAMPLE } from '@/lib/outreachReport.mjs';

export interface GateSender {
  senderId: string; label: string; fromEmail: string; language: string;
  capToday: number; capTomorrow: number; sentToday: number;
  tierToday: number | null; tierTomorrow: number | null; steppedBack: boolean; idleDays: number | null;
  warmup: string;   // today's limit in words
}
export interface CampaignState {
  gate: { allowed: boolean; blockers: string[]; warnings: string[]; capToday: number };
  senders: GateSender[];
  rates: { sent: number; bounced: number; blocked: number; bounce: number | null; block: number | null };
  settings: OutreachSettings;
  unseenReplies: number;
}

interface SenderDoc { senderId: string; label?: string; fromEmail: string; language?: string; firstSendAt?: string; dailyLimit?: number; warmup?: unknown; lastCheckedAt?: string; inboxTriedAt?: string }
type Status = { cap: number; tier: { fromDay: number } | null; steppedBack: boolean; idleDays: number | null };

// `lastTickAt` is the heartbeat the gate judges the loop by: the send round
// passes the one from BEFORE it started, the Control tab the current one.
export async function campaignState(lastTickAt: string, now = new Date()): Promise<CampaignState> {
  await dbConnect();
  const [docs, sentToday, lastBefore, counts, settings, unseenReplies] = await Promise.all([
    OutreachSender.find({ active: true, authSecret: { $gt: '' } }).select('senderId label fromEmail language firstSendAt dailyLimit warmup lastCheckedAt inboxTriedAt -_id').sort({ createdAt: 1 }).lean() as unknown as Promise<SenderDoc[]>,
    sentTodayBySender(now),
    lastSentBeforeToday(now),
    outcomeCounts(7, now),
    readSettings(),
    OutreachInbox.countDocuments({ kind: 'human', seenAt: '' }),
  ]);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const senders: GateSender[] = docs.map((d) => {
    const sent = sentToday.get(d.senderId) || 0;
    const today = warmupStatus({ ...d, lastSentBeforeToday: lastBefore.get(d.senderId) || '' }, now) as Status;
    // seen from tomorrow, "before today" includes today: an account that sends today is not idle tomorrow
    const next = warmupStatus({ ...d, lastSentBeforeToday: sent > 0 ? now.toISOString() : lastBefore.get(d.senderId) || '' }, tomorrow) as Status;
    return {
      senderId: d.senderId, label: d.label || d.fromEmail, fromEmail: d.fromEmail, language: d.language || 'en',
      capToday: today.cap, capTomorrow: next.cap, sentToday: sent,
      tierToday: today.tier ? today.tier.fromDay : null, tierTomorrow: next.tier ? next.tier.fromDay : null,
      steppedBack: today.steppedBack, idleDays: today.idleDays,
      warmup: describeWarmup({ ...d, lastSentBeforeToday: lastBefore.get(d.senderId) || '' }, now) as string,
    };
  });
  // a share of fewer than 30 emails says nothing, so it neither blocks nor warns
  const enough = counts.sent >= MIN_SAMPLE;
  const rates = { sent: counts.sent, bounced: counts.bounced, blocked: counts.blocked, bounce: enough ? counts.bounced / counts.sent : null, block: enough ? counts.blocked / counts.sent : null };
  const gate = campaignGate({
    now, senders, rates,
    ready: { secretKey: !!process.env.OUTREACH_SECRET_KEY, footer: !!(footerFor('en') || footerFor('hu')) },
    postmaster: settings.postmaster, seed: settings.seed, authConfirmedAt: settings.authConfirmedAt,
    repliesReviewedAt: settings.repliesReviewedAt, unseenReplies, lastTickAt,
    // the newest successful read of any mailbox, and the mailboxes whose last try was not one
    inboxReadAt: docs.map((d) => d.lastCheckedAt || '').sort().pop() || '',
    failingInboxes: docs.filter((d) => d.inboxTriedAt && (d.lastCheckedAt || '') < d.inboxTriedAt).map((d) => d.label || d.fromEmail),
  }) as CampaignState['gate'];
  return { gate, senders, rates, settings, unseenReplies };
}
