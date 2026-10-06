import mongoose, { Schema, model, models } from 'mongoose';

// A model whose schema is still changing. In production a model is compiled
// once per process. A local dev server lives through edits of this file, and a
// model that was compiled before a field existed drops that field on every
// write, without a word: the first sender account lost its warm-up tiers that
// way. So in development these models are compiled again whenever this file is
// loaded again.
function current(name: string, schema: Schema, collection?: string) {
  if (process.env.NODE_ENV !== 'production' && models[name]) mongoose.deleteModel(name);
  return models[name] || model(name, schema, collection);
}

// ── Folder ───────────────────────────────────────────────────────────────
const FolderSchema = new Schema({
  folderId: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  collapsed: { type: Boolean, default: true },
  order: { type: Number, default: 0 }, // manual drag-and-drop ordering
  parentId: { type: String, default: null, index: true }, // null = root; otherwise nested under this folder
  icon: { type: String, default: '' }, // optional emoji icon (business-type)
}, { versionKey: false });

// ── Project (one Google Maps search) ─────────────────────────────────────
const ProjectSchema = new Schema({
  query: { type: String, required: true, unique: true, index: true },
  name: String,
  createdAt: String,
  folderId: { type: String, default: null, index: true },
  population: { type: Number, default: null }, // for State-mode projects: the place's population
}, { versionKey: false });

// ── Lead (a scraped business) — separate collection, scales past 16MB/project
const LeadSchema = new Schema({
  project: { type: String, required: true, index: true },
  dedupKey: { type: String, required: true },
  placeId: String,
  cid: String,
  name: String,
  category: String,
  rating: { type: Number, default: null },
  reviewCount: { type: Number, default: null },
  phone: String,
  website: String,
  email: String,
  address: String,
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  mapsUrl: String,
  websiteStatus: String,
  leadScore: Number,
  leadTemperature: String,
  opportunityScore: Number,
  topPitch: String,
  checked: { type: Boolean, default: false },
  call: { type: Boolean, default: false }, // flagged for calling — shown in the Calls modal
  tags: { type: [String], default: [] },
  salesStatus: { type: String, default: '' }, // sales pipeline stage
  salesDate: { type: String, default: '' },   // date for callback / follow-up / meeting stages
  notes: { type: String, default: '' },       // free-form notes (auto-saved from the detail panel)
  emailSubject: { type: String, default: '' }, // GPT-generated outreach draft (editable, regenerable)
  emailBody: { type: String, default: '' },
  emailAt: { type: String, default: '' },      // ISO of last generate/edit
  emailSentAt: { type: String, default: '' },  // ISO when the draft was actually sent
  emailSentTo: { type: String, default: '' },  // recipient it went to
  smsBody: { type: String, default: '' },      // GPT-generated outreach SMS (editable, regenerable)
  smsAt: { type: String, default: '' },
  emailSearchAt: { type: String, default: '' }, // ISO of the last automated contact search ('' = never tried)
  // ── website email lookup (done by the extension — scrape-time + Email audit) ──
  emails: { type: [String], default: undefined }, // every usable address found on the site, best first
  emailSource: { type: String, default: '' },     // page URL the address was read from
  emailStatus: { type: String, default: '' },     // found | none | error | social | no_site
  emailCheckedAt: { type: String, default: '' },  // ISO of the last website lookup ('' = never checked)
  emailError: { type: String, default: '' },      // why the site could not be read (HTTP 403, timeout…)
  vapiCalls: { type: [Schema.Types.Mixed], default: [] }, // [{ id, at, endedReason }] — Vapi call history (Call tab)
  notesAt: { type: String, default: '' },     // ISO of the last notes edit; '' = no notes (Notes view filter+sort)

  // ── review scraping (separate Review collection holds the texts) ──────────
  reviewsScrapedAt: { type: String, default: '' }, // ISO when reviews were scraped; '' = not done yet (skip-if-done flag)
  reviewsCount: { type: Number, default: null },   // how many review rows we actually stored
  reviewsError: { type: String, default: '' },     // last scrape error (so failures can be retried/inspected)

  // ── AI insights (generated locally via the Claude CLI — see /api/enrich) ─────
  aiSummary: { type: String, default: '' },
  aiPainPoints: { type: String, default: '' },
  aiAdvantages: { type: String, default: '' },
  aiPitch: { type: String, default: '' },
  aiAt: { type: String, default: '' },             // ISO when generated; '' = not yet (skip-if-done)

  // lower-cased words of name / category / address / phone / email — what the lead
  // search matches by prefix (lib/searchTokens.mjs). Written by the server only.
  searchTokens: { type: [String], default: undefined },

  // ── outreach sequence state (docs/TASKS.md T-035) ─────────────────────────
  // Written by the server only: sync and import drop an incoming `seq`. No
  // defaults on purpose: a lead that was never enrolled has no `seq` at all, so
  // 1.6 million leads do not each store a dozen empty fields.
  seq: {
    sequenceId: String,
    stepId: String,         // the NEXT step to send
    nextStepAt: String,     // ISO (UTC), when that step is due
    senderId: String,       // the same sender for the whole sequence
    to: String,             // the address the sequence writes to, fixed at enrolment; replies and bounces are matched on it
    language: String,       // en | hu
    // The offer the second round makes, decided once at enrolment (lib/routeOffer.mjs).
    offer: String,          // ai | social
    offerScore: Number,     // how strongly the lead points at that offer, 0 to 100
    offerReasons: { type: [String], default: undefined }, // why, as short phrases for the operator and for a prompt
    offerManual: Boolean,   // true once the operator chose it by hand; never recomputed then
    tz: String,             // IANA time zone of the lead, found once at enrolment (lib/sendWindow.mjs); the send window runs on this clock
    threadSubject: String,
    lastMessageId: String,  // Message-ID of the last email sent (Gmail may rewrite it on the way out)
    sentStepIds: { type: [String], default: undefined },
    status: String,         // active | waiting (got the opening email; the follow-ups start when the operator starts them) | replied | bounced | finished | stopped | failed (three send errors in a row) | hold (a send that may or may not have gone out waits for the operator)
    claimedAt: String,      // ISO while a dispatcher round is working on this lead, '' otherwise (lib/sendGuard.mjs)
    errorCount: Number,     // send errors in a row; back to 0 after a send that worked
    softBounces: Number,    // temporary bounces so far; the third counts as a final one (lib/bounceRules.mjs)
    repliedAt: String,      // ISO when a person's reply was matched to this lead
    autoReplyAt: String,    // ISO of the last out-of-office note; it is not a reply, it only delays the next step
    lastSentAt: String,     // ISO
  },

  // ── signals read from the business's own website (lib/siteSignals.mjs) ────
  // Short values only; the page itself is never stored. No defaults: a lead
  // whose site was never read has no `sig`.
  sig: {
    booking: String,       // name of the booking engine found, '' = none
    ordering: String,      // name of the ordering service found, '' = none
    instagram: String,     // the Instagram handle the site links to, '' = none
    ok: Boolean,           // false = the site could not be read, the three above say nothing
    checkedAt: String,     // ISO of the read; missing = not read yet
  },

  hasBookingHint: Schema.Types.Mixed,
  scrapedAt: String,
}, { versionKey: false });

// ── Review (one Google Maps review for a business) — separate collection ──
const ReviewSchema = new Schema({
  project: { type: String, required: true },              // owning project (Lead.project)
  dedupKey: { type: String, required: true, index: true }, // the business id (globally single-homed); join key
  cid: String,
  placeId: String,
  reviewId: { type: String, default: '' },                // Google's review id when available — per-review dedup
  author: { type: String, default: '' },
  authorUrl: { type: String, default: '' },
  rating: { type: Number, default: null },
  text: { type: String, default: '' },
  relativeTime: { type: String, default: '' },            // e.g. "2 weeks ago" as scraped
  ownerResponse: { type: String, default: '' },
  scrapedAt: String,                                      // ISO when this review row was saved
}, { versionKey: false });

// ── ProjectStat (precomputed per-project lead counters) ──────────────────
// The sidebar/stat-tile numbers come from here instead of a live $group over
// 1.2M+ leads. Write paths call recomputeProjectStats() (lib/projectStats.ts)
// for the projects they touched; the ⟳ Recount button rebuilds everything.
const ProjectStatSchema = new Schema({
  project: { type: String, required: true, unique: true, index: true },
  total: { type: Number, default: 0 },
  noWebsite: { type: Number, default: 0 },
  hot: { type: Number, default: 0 },
  email: { type: Number, default: 0 },
  reviews: { type: Number, default: 0 },      // leads with ≥1 scraped review
  reviewsSum: { type: Number, default: 0 },   // total scraped review rows
  ai: { type: Number, default: 0 },           // leads with AI analysis
  emailMiss: { type: Number, default: 0 },      // website checked, no email found
  emailTodo: { type: Number, default: null },  // has a real website, no email, never checked (null = not counted yet)
  oppSum: { type: Number, default: 0 },       // sum of opportunityScore (avg = oppSum/total)
  updatedAt: String,
}, { versionKey: false });

// ── LeadGroup (a named, hand-picked set of leads) ────────────────────────
// Created from the currently-checked leads; members are dedupKeys (globally
// single-homed per the cross-project dedup rule, so no project needed).
const LeadGroupSchema = new Schema({
  groupId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  createdAt: String,
  keys: { type: [String], default: [] },
}, { versionKey: false });

// ── Tag (a reusable, colored label) — registry shared across all leads ────
const TagSchema = new Schema({
  name: { type: String, required: true, unique: true, index: true },
  color: { type: String, default: '#6366f1' },
}, { versionKey: false });

// Every index the dashboard relies on is declared here, with the name it has in
// production, so a fresh or restored database gets them too. Declaring an
// existing index under another name makes MongoDB refuse it: keep the names.
LeadSchema.index({ project: 1, dedupKey: 1 }, { unique: true });
LeadSchema.index({ dedupKey: 1 }); // cross-project duplicate lookups
LeadSchema.index({ searchTokens: 1 }); // word-prefix lead search
LeadSchema.index({ cid: 1 }); // Duplicates scan: the same business stored under two dedupKeys
LeadSchema.index({ websiteStatus: 1 });
LeadSchema.index({ leadTemperature: 1 });
// sort indexes (server-side pagination ordering)
LeadSchema.index({ opportunityScore: 1 });
LeadSchema.index({ leadScore: 1 });
LeadSchema.index({ rating: 1 });
LeadSchema.index({ reviewCount: 1 });
LeadSchema.index({ scrapedAt: 1 }); // Date column sort
LeadSchema.index({ notesAt: -1 }); // Notes view: leads with notes, newest edit first
LeadSchema.index({ tags: 1 }); // tag filtering
LeadSchema.index({ call: 1 }); // calls modal
LeadSchema.index({ email: 1 }); // has-email / no-email filters + counts
LeadSchema.index({ reviewsScrapedAt: 1, scrapedAt: -1 }); // "next business without reviews, most recent first"
LeadSchema.index({ reviewsCount: 1 }); // businesses-with-reviews lookup (Reviews view autocomplete)
LeadSchema.index({ opportunityScore: -1, _id: 1 }, { name: 'gl_opp_sort' }); // the default "all leads" page
LeadSchema.index({ project: 1, opportunityScore: -1, _id: 1 }, { name: 'gl_project_opp' }); // the same page inside a project or folder
LeadSchema.index({ emailCheckedAt: 1 }); // email audit filters ("checked, none found")
LeadSchema.index({ checked: 1 }); // the checked-leads count on every dashboard load, uncheck / delete all checked
LeadSchema.index({ name: 1 }); // "Name A–Z" sort
// "Email found": the ~5% of leads with an email, already in opportunity order.
// Without it MongoDB fetched all of them and sorted in memory on every page.
LeadSchema.index({ opportunityScore: -1, _id: 1 }, { name: 'gl_email_opp', partialFilterExpression: { email: { $gt: '' } } });
// "No email — website not checked yet": the top-scored leads have no website,
// so walking gl_opp_sort read ~500k leads to find the first 50 of these.
LeadSchema.index({ websiteStatus: 1, emailCheckedAt: 1, opportunityScore: -1, _id: 1 }, { name: 'gl_todo_opp' });
LeadSchema.index({ salesStatus: 1 }); // Status column sort
// The dispatcher's question, "what is due for this sender now". Partial: only
// leads in an active sequence are in it, so its size follows the running
// campaign, not the collection. A query must say 'seq.status': 'active' to use it.
LeadSchema.index({ 'seq.senderId': 1, 'seq.status': 1, 'seq.nextStepAt': 1 }, { name: 'gl_seq_due', partialFilterExpression: { 'seq.status': 'active' } });
// The map (GET /api/geo): a marker needs only these fields, so a map without
// extra filters is answered from the index and never reads a lead document.
// Reading 200 000 whole documents for four small fields took seconds.
LeadSchema.index({ project: 1, lat: 1, lng: 1, websiteStatus: 1, dedupKey: 1 }, { name: 'gl_geo' });
// Created by apps/tokenleads/scripts/source-indexes.mjs; declared here as well
// because the lead table sorts by lead score and by category through them.
LeadSchema.index({ leadScore: -1, _id: 1 }, { name: 'tl_leadscore_sort' });
LeadSchema.index({ category: 1, leadScore: -1 }, { name: 'tl_category_score' });

ReviewSchema.index({ dedupKey: 1 });                  // all reviews for a business
ReviewSchema.index({ scrapedAt: -1, _id: -1 });       // Reviews view: newest first, paged
ReviewSchema.index({ project: 1, dedupKey: 1 });      // scoped lookup matching Lead's key
// idempotent re-saves: never store the same Google review twice for a business
// (partial filter so rows WITHOUT a reviewId can still be inserted without colliding on '')
ReviewSchema.index({ dedupKey: 1, reviewId: 1 }, { unique: true, partialFilterExpression: { reviewId: { $gt: '' } } });

export const Folder = models.Folder || model('Folder', FolderSchema);
export const Project = models.Project || model('Project', ProjectSchema);
export const Lead = current('Lead', LeadSchema);
export const ProjectStat = models.ProjectStat || model('ProjectStat', ProjectStatSchema);
export const LeadGroup = models.LeadGroup || model('LeadGroup', LeadGroupSchema);
export const Tag = models.Tag || model('Tag', TagSchema);
export const Review = models.Review || model('Review', ReviewSchema);

// Statuses that count as "no real website". The same eight live in lib/scoring.mjs
// (WEBSITELESS), the extension (scoring.js, background.js, dashboard.js) and
// apps/landing/lib/models.ts: change every copy together.
export const NO_SITE = ['NO_WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'BROKEN', 'DOMAIN_EXPIRED', 'NOT_WORKING', 'DOMAIN_PARKED', 'UNDER_CONSTRUCTION'];

// A folder id plus every folder nested beneath it (any depth). Used so that
// selecting a parent folder scopes leads to all its sub-folders too.
export async function descendantFolderIds(rootId: string): Promise<string[]> {
  const all = await Folder.find().select('folderId parentId -_id').lean() as { folderId: string; parentId?: string | null }[];
  const childrenOf: Record<string, string[]> = {};
  for (const f of all) { const p = f.parentId || ''; (childrenOf[p] = childrenOf[p] || []).push(f.folderId); }
  const out: string[] = []; const stack = [rootId];
  while (stack.length) { const id = stack.pop() as string; out.push(id); for (const c of (childrenOf[id] || [])) stack.push(c); }
  return out;
}

// ── Timezone map focus (cross-app relay) ─────────────────────────────────
// A single row the standalone timezone-map app polls, so clicking a lead here
// updates a map already open on another screen instead of opening a new tab.
const TimezoneFocusSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true }, // always 'current'
  q: String,      // address for the map to geocode
  label: String,  // business name, for display
  ts: Number,     // bumped on every write so pollers can spot a change
}, { versionKey: false });

export const TimezoneFocus = models.TimezoneFocus || model('TimezoneFocus', TimezoneFocusSchema);

// ── Outreach sequence (a series of emails; docs/TASKS.md T-035) ───────────
// The emails exist as data, not in a prompt, so their order, waits and wording
// can be edited. A step is { id, delayDays, subject, body, sameThread, enabled,
// variantOf?, weight? }; the rules are in lib/outreachSequence.mjs. Steps are
// Mixed on purpose: a lead points at a step by its `id`, and a step subdocument
// would get an `_id` of its own beside it.
const OutreachSequenceSchema = new Schema({
  sequenceId: { type: String, required: true, unique: true, index: true },
  name: String,
  language: { type: String, default: 'en' },   // en | hu
  senderIds: { type: [String], default: [] },  // empty = every sender
  steps: { type: [Schema.Types.Mixed], default: [] },
  stopOnReply: { type: Boolean, default: true },
  stopOnBounce: { type: Boolean, default: true },
  enabled: { type: Boolean, default: false },  // a new sequence sends nothing until it is switched on
  // false: after the opening email a lead waits (`seq.status: 'waiting'`) until
  // the operator starts its follow-ups. true: the steps follow by themselves.
  autoFollowUp: { type: Boolean, default: false },
  createdAt: String, updatedAt: String,
}, { versionKey: false });

export const OutreachSequence = current('OutreachSequence', OutreachSequenceSchema);

// ── Suppression list (who must never be written to again; lib/suppression.ts) ─
// Apart from the lead on purpose: it has to outlive a deleted and re-scraped lead.
// A row is one address, or a whole company domain (then `email` is "@domain").
const SuppressionSchema = new Schema({
  email: { type: String, required: true, unique: true, index: true }, // lower-cased
  domain: { type: String, default: '' },   // set only on a domain-wide row
  reason: { type: String, default: '' },   // stop | hard_bounce | complaint | manual | import
  source: { type: String, default: '' },   // which sequence or sender it came from
  note: { type: String, default: '' },
  createdAt: String,
}, { versionKey: false });
SuppressionSchema.index({ domain: 1 });

export const Suppression = current('Suppression', SuppressionSchema);

// ── Outreach send (one row per email sent; lib/outreachSends.ts) ───────────
// A row that can change, which the append-only activity log cannot give: the
// outcome of an email arrives later (a bounce or a reply, days after). The
// report counts from here only.
const OutreachSendSchema = new Schema({
  project: { type: String, required: true },
  dedupKey: { type: String, required: true, index: true },
  sequenceId: String,      // '' = sent by hand from the lead panel
  stepId: String,          // the variant that really went out
  senderId: String,
  messageId: { type: String, index: true },  // as the SMTP library returned it
  to: String,              // lower-cased
  toDomain: String,
  language: String,
  isSeed: { type: Boolean, default: false },   // a test address of ours, not a lead: kept out of every rate
  offer: { type: String, default: '' },        // ai | social: the lead's second-round offer at the time, so the report can compare the two without reading `leads`
  sentAt: String,                              // ISO
  // sending: written BEFORE the email is handed to the mail server. unknown: a
  // `sending` row whose round died; the email may have gone out, the operator
  // decides. failed: the mail server refused it, nothing left.
  // bounced: the address is dead. blocked: the address is fine, WE were refused;
  // counted apart because the cure is less volume, not a cleaner list.
  outcome: { type: String, default: 'sent' },  // sending | sent | unknown | failed | delivered | bounced | blocked | complained | replied | stopped
  outcomeAt: { type: String, default: '' },
  placement: { type: String, default: '' },    // inbox | spam | promotions | missing (seed sends)
  // from the bounce email, when one came back (lib/bounceRules.mjs)
  bounceKind: { type: String, default: '' },   // hard | soft | block
  bounceStatus: { type: String, default: '' }, // the enhanced code, 5.1.1 and the like
  bounceDiagnostic: { type: String, default: '' }, // the receiving server's own words, cut short
}, { versionKey: false });
OutreachSendSchema.index({ sentAt: -1 });
OutreachSendSchema.index({ senderId: 1, sentAt: -1 });
OutreachSendSchema.index({ sequenceId: 1, stepId: 1 });
OutreachSendSchema.index({ outcome: 1, sentAt: -1 }); // the `sending` rows left behind by a dead round, and the `unknown` ones waiting for a decision
OutreachSendSchema.index({ toDomain: 1 }); // has this company been written to before? asked at enrolment
OutreachSendSchema.index({ to: 1, sentAt: -1 }); // a bounce or a reply is matched to the latest send to that address

export const OutreachSend = current('OutreachSend', OutreachSendSchema);

// ── Outreach sender (a mailbox that sends and receives; lib/outreachSenders.ts) ─
// `authSecret` is the account's app password sealed by lib/secretBox.mjs, never
// the plain text. `select: false` keeps it out of every query that does not ask
// for it by name, so it cannot slip into a response by accident.
const OutreachSenderSchema = new Schema({
  senderId: { type: String, required: true, unique: true, index: true },
  label: String,
  fromName: String,                // a person's name, not a company's
  fromEmail: { type: String, required: true, unique: true }, // lower-cased
  language: { type: String, default: 'en' },  // en | hu
  smtpHost: String, smtpPort: Number,
  imapHost: String, imapPort: Number,
  authUser: String,
  authSecret: { type: String, default: '', select: false },
  // The daily limit (lib/warmup.mjs). The tiers are counted from the account's
  // own first successful send, so an account added today starts at the bottom.
  firstSendAt: { type: String, default: '' },      // ISO; '' until the first email went out
  dailyLimit: { type: Number, default: 100 },      // the ceiling no tier can lift
  warmup: {
    enabled: { type: Boolean, default: true },
    tiers: { type: [{ _id: false, fromDay: Number, dailyLimit: Number }], default: undefined }, // sorted by fromDay on save
  },
  active: { type: Boolean, default: false },       // switched on and off without a deploy
  // When this account sends, on the RECIPIENT's clock (lib/sendWindow.mjs).
  sendDays: { type: [Number], default: undefined }, // 1 = Monday ... 7 = Sunday; unset = Monday to Friday
  windowFrom: { type: Number, default: 7 },        // first sending hour
  windowTo: { type: Number, default: 19 },         // the hour sending stops
  // where the IMAP watcher stands in this mailbox (lib/inboxPlan.mjs)
  uidValidity: { type: String, default: '' },
  lastSeenUid: { type: Number, default: 0 },
  lastCheckedAt: { type: String, default: '' },    // ISO of the last IMAP round that worked
  inboxTriedAt: { type: String, default: '' },     // ISO of the last attempt, worked or not: the mailbox tried longest ago is next, so one broken mailbox cannot keep the others from being read
  lastTickAt: { type: String, default: '' },       // ISO of the last time the dispatcher handled this account
  roundAt: { type: String, default: '' },          // ISO while a send round is working with this account, '' otherwise: one round per account at a time
  notes: { type: String, default: '' },
  createdAt: String, updatedAt: String,
}, { versionKey: false });

export const OutreachSender = current('OutreachSender', OutreachSenderSchema);

// ── Outreach inbox (one row per email that arrived in a sender mailbox) ────
// Outreach goes out over SMTP, so every answer comes back as mail: a reply, a
// bounce, an out-of-office note. The IMAP watcher (lib/inboxWatcher.ts) writes
// one row per message. The unique key makes a message count once however often
// it is read, and a message that matches no lead stays here, visible.
const OutreachInboxSchema = new Schema({
  senderId: { type: String, required: true },
  uidValidity: { type: String, default: '' },  // UIDs mean something only together with this
  uid: { type: Number, required: true },
  messageId: { type: String, default: '' },
  kind: String,                                // bounce | auto | human
  from: String,                                // lower-cased address
  subject: String,
  at: String,                                  // ISO, when the mailbox received it
  snippet: { type: String, default: '' },      // the start of the text; for a reply, what the person wrote
  stop: { type: Boolean, default: false },     // a reply that asks us to stop
  bounceKind: { type: String, default: '' },   // hard | soft | block | unknown
  bounceStatus: { type: String, default: '' },
  bounceRecipient: { type: String, default: '' },  // as the delivery report named it; kept so a message can be handled again from its row alone
  bounceDiagnostic: { type: String, default: '' },
  attempts: { type: Number, default: 0 },      // failed tries to handle it; after five it is left for the operator
  authenticated: { type: Boolean, default: false }, // Gmail's own check vouches for the From address
  trustedBounce: { type: Boolean, default: false }, // a delivery report proven to come from Google's mail system
  ignored: { type: String, default: '' },      // why it was stored without any effect; '' = it was acted on
  // the lead it was matched to; empty = matched nothing, the operator has to look
  project: { type: String, default: '' },
  dedupKey: { type: String, default: '' },
  leadName: { type: String, default: '' },
  sequenceId: { type: String, default: '' },
  stepId: { type: String, default: '' },       // the step the answered email was
  matchedBy: { type: String, default: '' },    // address | subject | ''
  handledAt: { type: String, default: '' },    // ISO once its effect is written; '' = stored but not handled yet
  seenAt: { type: String, default: '' },       // ISO once the operator has looked at it
  createdAt: String,
}, { versionKey: false });
OutreachInboxSchema.index({ senderId: 1, uidValidity: 1, uid: 1 }, { unique: true });
OutreachInboxSchema.index({ senderId: 1, messageId: 1 }); // the duplicate check after a UIDVALIDITY change
OutreachInboxSchema.index({ kind: 1, at: -1 });           // the Replies view

// the collection name is given: Mongoose would make it `outreachinboxes`, the approved name is `outreachinbox`
export const OutreachInbox = current('OutreachInbox', OutreachInboxSchema, 'outreachinbox');

// shared CORS headers so the Chrome extension can call these endpoints
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-gl-gzip',
};

// `timing` (name → milliseconds) becomes a Server-Timing header, so the browser's
// network panel shows how much of a slow request was the database. Names and
// durations only: never put query text or data in it.
export function json(data: unknown, init?: ResponseInit, timing?: Record<string, number>) {
  const st: Record<string, string> = timing ? { 'Server-Timing': Object.entries(timing).map(([k, v]) => `${k};dur=${v.toFixed(1)}`).join(', ') } : {};
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...CORS, ...st, ...(init?.headers || {}) },
  });
}

export { mongoose };
