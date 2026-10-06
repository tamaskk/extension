// Sends one step of a sequence to the seed list: the operator's own test
// mailboxes at different providers. Server code. It sends real email, to those
// addresses only.
//
// The mail server's "250" only says it took the email, and no bounce only says
// nobody refused it. Neither says whether the email is in the inbox or in the
// spam folder, and nothing over SMTP ever will. The only way to know is to send
// the same email to mailboxes of one's own and look. This sends; the looking
// is done by hand, and the result is entered on the Control tab.
import nodemailer from 'nodemailer';
import { dbConnect } from '@/lib/db';
import { Lead, OutreachSender, OutreachSequence } from '@/lib/models';
import { open } from '@/lib/secretBox.mjs';
import { beginSend, failSend, finishSend } from '@/lib/outreachSends';
import { OutreachSend } from '@/lib/models';
import { isSuppressed } from '@/lib/suppression';
import { readSettings } from '@/lib/outreachSettings';
import { stepById } from '@/lib/outreachSequence.mjs';
import { VARIABLE_FIELDS, render, renderContext } from '@/lib/outreachRender.mjs';
import { preflight } from '@/lib/outreachPreflight.mjs';
import { buildMessage } from '@/lib/outreachMessage.mjs';
import { footerFor, withFooter } from '@/lib/outreachFooter.mjs';
import { mailEndpointAllowed } from '@/lib/outreachSenderRules.mjs';

export interface SeedResult { ok: boolean; error?: string; sent?: string[]; failed?: string[] }

interface SenderDoc { senderId: string; fromName?: string; fromEmail: string; smtpHost?: string; smtpPort?: number; authUser?: string; authSecret?: string }
interface StepDoc { id: string; subject?: string; body?: string }

export async function sendSeedTest(senderId: string, sequenceId: string, stepId: string): Promise<SeedResult> {
  await dbConnect();
  const { seedAddresses } = await readSettings();
  if (!seedAddresses.length) return { ok: false, error: 'There are no seed addresses yet. Enter them first.' };
  // Counted from the rows, not in memory: a seed test is a handful of emails, never a way round the daily limits.
  const lastHour = await OutreachSend.countDocuments({ isSeed: true, sentAt: { $gte: new Date(Date.now() - 3_600_000).toISOString() } });
  if (lastHour + seedAddresses.length > 40) return { ok: false, error: 'Too many seed emails went out in the last hour. Read their results first.' };
  const sender = await OutreachSender.findOne({ senderId }).select('+authSecret -_id').lean() as unknown as SenderDoc | null;
  if (!sender || !sender.authSecret) return { ok: false, error: 'Choose a sender account that has a stored password.' };
  if (!mailEndpointAllowed('smtp', sender.smtpHost, sender.smtpPort)) return { ok: false, error: 'This account points at a mail server that is not allowed.' };
  const sequence = await OutreachSequence.findOne({ sequenceId }).select('-_id').lean() as unknown as { sequenceId: string; language?: string; steps?: StepDoc[] } | null;
  const step = sequence ? stepById(sequence, stepId) as StepDoc | null : null;
  if (!sequence || !step) return { ok: false, error: 'Choose a sequence and one of its steps.' };

  // The text as a real lead would get it: a seed test of an unrendered template tests nothing.
  const lead = await Lead.findOne({ email: { $gt: '' } }).sort({ opportunityScore: -1, _id: 1 }).select([...VARIABLE_FIELDS, '-_id'].join(' ')).lean() as Record<string, unknown> | null;
  const values = renderContext(lead || {});
  const subject = render(step.subject || '', values);
  const body = render(step.body || '', values);
  const lang = sequence.language || 'en';
  const footer = footerFor(lang);
  const text = withFooter(body.out, lang);
  const check = preflight({ subject: subject.out || 'Seed test', text, footer, to: seedAddresses[0], missing: [...subject.missing, ...body.missing] }) as { ok: boolean; blocks: string[] };
  if (!check.ok) return { ok: false, error: `This step cannot be sent as it is. ${check.blocks.join(' ')}` };

  const transport = nodemailer.createTransport({
    host: sender.smtpHost, port: sender.smtpPort, secure: sender.smtpPort === 465, requireTLS: sender.smtpPort !== 465,
    auth: { user: sender.authUser || sender.fromEmail, pass: open(sender.authSecret) },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const sent: string[] = [], failed: string[] = [];
  try {
    for (const to of seedAddresses) {
      // the list holds for our own test mailboxes too; when it cannot be read this throws and nothing is sent
      if (await isSuppressed(to)) { failed.push(to); continue; }
      // recorded like every email, and marked as a seed: it counts in the sender's day and stays out of the rates
      // a seed address belongs to no project, but the row's `project` is required and may not be empty
      const id = await beginSend({ project: 'seed', dedupKey: `seed:${to}`, to, sequenceId: sequence.sequenceId, stepId: step.id, senderId: sender.senderId, language: lang, isSeed: true });
      try {
        const info = await transport.sendMail(buildMessage({ sender, to, subject: subject.out || 'Seed test', text, sameThread: false, threadSubject: '', lastMessageId: '' }));
        await finishSend(id, String(info.messageId || ''));
        sent.push(to);
      } catch (e) {
        // only the code is logged; the library's message can carry the login name
        console.error('seed send failed', e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'no code');
        // a seed is never sent again by a machine either way, so a row of unknown fate is closed as failed here
        await failSend(id);
        failed.push(to);
      }
    }
  } finally {
    transport.close();
  }
  return { ok: sent.length > 0, sent, failed, ...(sent.length ? {} : { error: 'None of the seed emails could be sent. Test the connection of the sender account.' }) };
}
