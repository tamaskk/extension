// Sender accounts: reading them for the dashboard, and using their app password
// where a connection needs it. Server code.
//
// The password has one way in (sealed on save) and one way out (opened here,
// for a connection). It never goes into a response, a log line, an activity
// event or an error message.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { dbConnect } from '@/lib/db';
import { OutreachSender } from '@/lib/models';
import { sentTodayBySender } from '@/lib/outreachSends';
import { open } from '@/lib/secretBox.mjs';
import { connectionFailure, connectionMessage, mailEndpointAllowed } from '@/lib/outreachSenderRules.mjs';
import { DEFAULT_DAILY_LIMIT, dailyCapFor, normalizeTiers } from '@/lib/warmup.mjs';
import { windowOf } from '@/lib/sendWindow.mjs';
import type { OutreachSenderRow, WarmupTier } from '@/lib/types';

interface SenderDoc {
  senderId: string; label?: string; fromName?: string; fromEmail: string; language?: string;
  smtpHost?: string; smtpPort?: number; imapHost?: string; imapPort?: number; authUser?: string;
  authSecret?: string; active?: boolean;
  firstSendAt?: string; dailyLimit?: number; warmup?: { enabled?: boolean; tiers?: WarmupTier[] };
  sendDays?: number[]; windowFrom?: number; windowTo?: number;
  lastTickAt?: string; lastCheckedAt?: string; notes?: string;
}

// Every account, as the dashboard may see it, oldest first.
export async function listSenders(now = new Date()): Promise<OutreachSenderRow[]> {
  await dbConnect();
  // +authSecret only to learn whether one is stored; it is dropped below
  const docs = await OutreachSender.find().select('+authSecret -_id').sort({ createdAt: 1 }).lean() as unknown as SenderDoc[];
  const sent = await sentTodayBySender(now);
  return docs.map((d) => {
    const limits = {
      dailyLimit: typeof d.dailyLimit === 'number' ? d.dailyLimit : DEFAULT_DAILY_LIMIT,
      firstSendAt: d.firstSendAt || '',
      warmup: { enabled: d.warmup?.enabled !== false, tiers: normalizeTiers(d.warmup?.tiers) as WarmupTier[] },
    };
    const window = windowOf(d) as { days: number[]; from: number; to: number };
    return {
    senderId: d.senderId,
    label: d.label || '',
    fromName: d.fromName || '',
    fromEmail: d.fromEmail,
    language: d.language === 'hu' ? 'hu' : 'en',
    smtpHost: d.smtpHost || '', smtpPort: d.smtpPort || 0,
    imapHost: d.imapHost || '', imapPort: d.imapPort || 0,
    authUser: d.authUser || '',
    hasPassword: !!d.authSecret,
    active: !!d.active,
    ...limits,
    sendDays: window.days, windowFrom: window.from, windowTo: window.to,
    capToday: dailyCapFor(limits, now),
    sentToday: sent.get(d.senderId) || 0,
    lastTickAt: d.lastTickAt || '',
    lastCheckedAt: d.lastCheckedAt || '',
    notes: d.notes || '',
    };
  });
}

export interface ChannelResult { ok: boolean; message: string }

// Log in over SMTP and over IMAP with the stored password and say whether each
// worked. Sends nothing and reads nothing. null when the account does not exist.
// Throws when the password cannot be opened (the master key is missing or wrong).
export async function testSenderConnection(senderId: string): Promise<{ smtp: ChannelResult; imap: ChannelResult; hasPassword: boolean } | null> {
  await dbConnect();
  const d = await OutreachSender.findOne({ senderId }).select('+authSecret -_id').lean() as unknown as SenderDoc | null;
  if (!d) return null;
  if (!d.authSecret) {
    const none = { ok: false, message: 'No app password is stored for this account.' };
    return { smtp: none, imap: none, hasPassword: false };
  }
  // Before the password is opened: it must only ever travel to Google.
  if (!mailEndpointAllowed('smtp', d.smtpHost, d.smtpPort) || !mailEndpointAllowed('imap', d.imapHost, d.imapPort)) {
    const off = { ok: false, message: 'This account points at a mail server that is not allowed. Edit its hosts and ports back to Gmail.' };
    return { smtp: off, imap: off, hasPassword: true };
  }
  const pass = open(d.authSecret);
  const user = d.authUser || d.fromEmail;

  const smtp = async (): Promise<ChannelResult> => {
    const transport = nodemailer.createTransport({
      host: d.smtpHost, port: d.smtpPort,
      // 465 speaks TLS from the first byte; every other port must upgrade with STARTTLS
      secure: d.smtpPort === 465, requireTLS: d.smtpPort !== 465,
      auth: { user, pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    try {
      await transport.verify();
      return { ok: true, message: connectionMessage('SMTP', 'ok') };
    } catch (e) {
      return { ok: false, message: connectionMessage('SMTP', connectionFailure(e)) };
    } finally {
      transport.close();
    }
  };

  const imap = async (): Promise<ChannelResult> => {
    const client = new ImapFlow({
      host: d.imapHost || '', port: d.imapPort || 993, secure: true,
      auth: { user, pass },
      logger: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    // Without a listener an error after the login is thrown into the process and
    // printed with the server's own words. The result below already covers it.
    client.on('error', () => {});
    try {
      await client.connect();
      await client.logout().catch(() => client.close());
      return { ok: true, message: connectionMessage('IMAP', 'ok') };
    } catch (e) {
      client.close();
      return { ok: false, message: connectionMessage('IMAP', connectionFailure(e)) };
    }
  };

  const [s, i] = await Promise.all([smtp(), imap()]);
  return { smtp: s, imap: i, hasPassword: true };
}
