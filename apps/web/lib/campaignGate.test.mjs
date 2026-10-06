import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE, campaignGate } from './campaignGate.mjs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();
const sender = (over = {}) => ({ label: 'Tom', capToday: 20, capTomorrow: 20, sentToday: 4, tierToday: 7, tierTomorrow: 7, steppedBack: false, idleDays: 1, ...over });
// everything in order
const input = (over = {}) => ({
  now: NOW, ready: { secretKey: true, footer: true }, senders: [sender()],
  rates: { bounce: 0.005, block: 0 }, postmaster: { spamRate: 0.02, date: daysAgo(2) }, seed: { date: daysAgo(3), inbox: 7, of: 8 },
  authConfirmedAt: daysAgo(30), repliesReviewedAt: minutesAgo(120), unseenReplies: 0, lastTickAt: minutesAgo(1), inboxReadAt: minutesAgo(3), failingInboxes: [], ...over,
});

test('with everything in order the gate is open and says nothing', () => {
  assert.deepEqual(campaignGate(input()), { allowed: true, blockers: [], warnings: [], capToday: 20 });
});

test('a bounce rate of 6 % shuts the gate and the blocker names the bounces', () => {
  const g = campaignGate(input({ rates: { bounce: 0.06, block: 0 } }));

  assert.equal(g.allowed, false);
  assert.equal(g.blockers.length, 1);
  assert.match(g.blockers[0], /bounce rate of the last 7 days is 6 %/);
});

test('a bounce rate of 2.5 % lets the email go, with a warning', () => {
  const g = campaignGate(input({ rates: { bounce: 0.025, block: 0 } }));

  assert.equal(g.allowed, true);
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /2\.5 %/);
});

test('blocked emails over 1 % shut the gate, over 0.3 % they warn', () => {
  assert.equal(campaignGate(input({ rates: { bounce: 0, block: 0.012 } })).allowed, false);
  const warned = campaignGate(input({ rates: { bounce: 0, block: 0.005 } }));
  assert.equal(warned.allowed, true);
  assert.equal(warned.warnings.length, 1);
});

test('while too few emails went out, the rates neither block nor warn', () => {
  assert.deepEqual(campaignGate(input({ rates: { bounce: null, block: null } })).blockers, []);
});

test('a seed test 20 days old shuts the gate; 8 days old only warns', () => {
  const old = campaignGate(input({ seed: { date: daysAgo(20), inbox: 8, of: 8 } }));
  const ageing = campaignGate(input({ seed: { date: daysAgo(8), inbox: 8, of: 8 } }));

  assert.equal(old.allowed, false);
  assert.match(old.blockers[0], /seed test was 20 days ago/);
  assert.equal(ageing.allowed, true);
  assert.match(ageing.warnings[0], /seed test was 8 days ago/);
});

test('no seed test at all shuts the gate', () => {
  assert.equal(campaignGate(input({ seed: {} })).allowed, false);
  assert.equal(campaignGate(input({ seed: undefined })).allowed, false);
});

test('a Postmaster figure 15 days old shuts the gate', () => {
  const g = campaignGate(input({ postmaster: { spamRate: 0.02, date: daysAgo(15) } }));

  assert.equal(g.allowed, false);
  assert.match(g.blockers[0], /entered 15 days ago/);
});

test('a Postmaster spam rate over 0.3 % shuts the gate, over 0.1 % warns, never entered shuts it', () => {
  assert.equal(campaignGate(input({ postmaster: { spamRate: 0.4, date: daysAgo(1) } })).allowed, false);
  assert.equal(campaignGate(input({ postmaster: { spamRate: 0.2, date: daysAgo(1) } })).warnings.length, 1);
  assert.equal(campaignGate(input({ postmaster: {} })).allowed, false);
  assert.equal(campaignGate(input({ postmaster: { spamRate: 0.02, date: daysAgo(14) } })).allowed, true);
});

test('a send loop silent for 12 minutes shuts the gate', () => {
  const g = campaignGate(input({ lastTickAt: minutesAgo(12) }));

  assert.equal(g.allowed, false);
  assert.match(g.blockers[0], /has not run for 12 minutes/);
  assert.equal(campaignGate(input({ lastTickAt: minutesAgo(9) })).allowed, true);
  assert.equal(campaignGate(input({ lastTickAt: '' })).allowed, false);
});

test('several blockers are all listed, not only the first', () => {
  const g = campaignGate(input({ rates: { bounce: 0.06, block: 0.02 }, seed: { date: daysAgo(20) }, postmaster: { spamRate: 0.02, date: daysAgo(15) }, lastTickAt: minutesAgo(12), authConfirmedAt: '' }));

  assert.equal(g.allowed, false);
  assert.equal(g.blockers.length, 6);
  assert.equal(campaignGate(input({ rates: { bounce: 0.06, block: 0.02 }, inboxReadAt: minutesAgo(45) })).blockers.length, 3);
});

test('senders without authentication confirmed, a missing key or footer, and no sender each shut the gate', () => {
  assert.match(campaignGate(input({ authConfirmedAt: '' })).blockers[0], /SPF, DKIM and DMARC/);
  assert.match(campaignGate(input({ ready: { secretKey: false, footer: true } })).blockers[0], /OUTREACH_SECRET_KEY/);
  assert.match(campaignGate(input({ ready: { secretKey: true, footer: false } })).blockers[0], /footer/);
  assert.match(campaignGate(input({ senders: [] })).blockers[0], /No sender account/);
});

test('a day on which the warm-up gives every sender 0 shuts the gate', () => {
  const g = campaignGate(input({ senders: [sender({ capToday: 0 }), sender({ label: 'Tamás', capToday: 0 })] }));

  assert.equal(g.allowed, false);
  assert.match(g.blockers[0], /limit of 0 today/);
  assert.equal(campaignGate(input({ senders: [sender({ capToday: 0 }), sender({ capToday: 10 })] })).allowed, true);
});

test('replies nobody read for over 24 hours are a warning', () => {
  const g = campaignGate(input({ repliesReviewedAt: minutesAgo(30 * 60), unseenReplies: 3 }));

  assert.equal(g.allowed, true);
  assert.match(g.warnings[0], /read the replies for 30 hours; 3 are waiting/);
  assert.deepEqual(campaignGate(input({ repliesReviewedAt: '', unseenReplies: 0 })).warnings, []);
  assert.equal(campaignGate(input({ repliesReviewedAt: '', unseenReplies: 2 })).warnings.length, 1);
});

test('a sender that steps up tomorrow, or was stepped back today, is a warning with its reason', () => {
  const up = campaignGate(input({ senders: [sender({ capTomorrow: 30, tierTomorrow: 14 })] }));
  const back = campaignGate(input({ senders: [sender({ steppedBack: true, idleDays: 4, capToday: 10 })] }));

  assert.match(up.warnings[0], /moves to its next warm-up tier tomorrow: 30 a day instead of 20/);
  assert.match(back.warnings[0], /one warm-up tier lower today, because it sent nothing for 4 days/);
});

test('the limit of the day is the sum of the senders\' limits', () => {
  assert.equal(campaignGate(input({ senders: [sender({ capToday: 10 }), sender({ capToday: 35 })] })).capToday, 45);
});

test('every threshold lives in one constant', () => {
  assert.deepEqual([GATE.bounceBlock, GATE.bounceWarn, GATE.blockBlock, GATE.blockWarn, GATE.spamBlock, GATE.spamWarn], [0.05, 0.02, 0.01, 0.003, 0.3, 0.1]);
  assert.deepEqual([GATE.postmasterMaxAgeDays, GATE.seedMaxAgeDays, GATE.seedWarnAgeDays, GATE.repliesWarnHours, GATE.runnerDeadMinutes, GATE.inboxDeadMinutes], [14, 14, 7, 24, 10, 30]);
});

test('mailboxes nobody read for over 30 minutes shut the gate, and so does never having read one', () => {
  const silent = campaignGate(input({ inboxReadAt: minutesAgo(45) }));

  assert.equal(silent.allowed, false);
  assert.match(silent.blockers[0], /No sender mailbox has been read for 45 minutes/);
  assert.equal(campaignGate(input({ inboxReadAt: '' })).allowed, false);
  assert.equal(campaignGate(input({ inboxReadAt: minutesAgo(29) })).allowed, true);
});

test('a mailbox that failed at its last try is a warning with its name', () => {
  const g = campaignGate(input({ failingInboxes: ['Tamás'] }));

  assert.equal(g.allowed, true);
  assert.match(g.warnings[0], /mailbox of Tamás could not be read/);
});
