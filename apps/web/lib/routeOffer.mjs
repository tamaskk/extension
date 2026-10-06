// Which offer a lead gets in the second round of a sequence: AI automation or
// social media marketing. Pure: lead in, decision out, no database, no network,
// so it can be tested and explained.
//
// The first round is web development for everyone. lib/scoring.mjs says how
// GOOD a lead is; this says WHICH service fits it, and is a separate function
// that does not touch the opportunity score. Offering an AI agent to a
// hairdresser and Instagram reels to a wholesaler is equally unconvincing, and
// the data to tell them apart is already on the lead.
//
// The weights are guesses until the reports show which offer gets answers in
// which category. That is why every decision comes with its reasons, and why
// the category table is one constant at the top: it is what gets tuned.

// Words in a Maps category (English and Hungarian) that pull towards an offer.
// A category can match both lists; the other signals decide then.
export const CATEGORY_TABLE = {
  // works by appointment: missed calls and callbacks are lost customers
  ai: ['clinic', 'dentist', 'dental', 'doctor', 'medical', 'physio', 'chiropract', 'veterinar', 'optician', 'hair salon', 'barber', 'salon', 'repair', 'service', 'mechanic', 'plumber', 'electrician', 'hvac', 'lawyer', 'attorney', 'law firm', 'notary', 'accountant', 'bookkeep', 'insurance', 'real estate',
    'klinika', 'rendelő', 'fogorvos', 'fogászat', 'orvos', 'állatorvos', 'optika', 'fodrász', 'szalon', 'szerviz', 'szerelő', 'javít', 'ügyvéd', 'közjegyző', 'könyvelő', 'biztosít', 'ingatlan'],
  // lives on how it looks: nobody finds it if nobody sees it
  social: ['restaurant', 'cafe', 'coffee', 'bistro', 'bar', 'pub', 'bakery', 'pastry', 'pizza', 'burger', 'fitness', 'gym', 'yoga', 'pilates', 'beauty', 'nail', 'lash', 'cosmetic', 'spa', 'clothing', 'boutique', 'fashion', 'jewel', 'tattoo', 'florist', 'flower', 'photograph', 'hotel', 'wedding',
    'étterem', 'kávézó', 'kávéház', 'bisztró', 'cukrászda', 'pékség', 'pizzéria', 'edzőterem', 'jóga', 'szépség', 'köröm', 'kozmetik', 'műköröm', 'szempilla', 'ruha', 'butik', 'divat', 'ékszer', 'tetovál', 'virág', 'fotó', 'szálloda', 'esküvő'],
};

// What reviews say when the phone is not answered. Read from the AI summary of
// the reviews, when the lead has one.
const REACH_COMPLAINT = /(didn'?t|did not|never|no one|nobody|won'?t) (pick(ed)? up|answer(ed)?|call(ed)? back|return(ed)? (my|our|the) call)|unanswered|no answer|hard to reach|couldn'?t reach|long wait|waiting time|on hold|nem vett(é|e)k fel|nem h(í|i)vtak vissza|nem lehet el(é|e)rni|el(é|e)rhetetlen|v(á|a)rakoz/i;

// The two sides must be at least this far apart for a clear decision.
export const MARGIN = 10;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const matches = (category, words) => words.some((w) => category.includes(w));

// → { offer: 'ai' | 'social', score: 0..100, reasons: string[] }
// Deterministic and never throws: a missing field gives no points, nothing
// else. `score` is how strongly the lead points at the chosen offer. The
// reasons are short Hungarian phrases: they go on the lead panel and into the
// prompt when a text is generated.
// A close call (the two sides within MARGIN points) goes to 'social', the offer
// with the lower threshold, and says so in its reasons, so the operator can
// filter those leads and decide them by hand.
export function routeOffer(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  const category = String(l.category || '').toLowerCase();
  const reviews = num(l.reviewCount), rating = num(l.rating);
  const sig = l.sig && typeof l.sig === 'object' ? l.sig : null;
  // signals count only when the website was really read: a site that could not be fetched says nothing
  const sigKnown = !!(sig && sig.checkedAt && sig.ok !== false);
  let ai = 0, social = 0;
  const why = { ai: [], social: [] };
  const add = (side, points, reason) => { if (side === 'ai') ai += points; else social += points; why[side].push(reason); };

  // towards AI automation
  if (reviews !== null && rating !== null && reviews >= 100 && rating < 4.0) add('ai', 35, 'sok értékelés, gyenge átlag');
  else if (reviews !== null && rating !== null && reviews >= 50 && rating < 4.3) add('ai', 15, 'forgalmas hely, közepes átlag');
  if (category && matches(category, CATEGORY_TABLE.ai)) add('ai', 30, 'időpontos kategória');
  const booking = sigKnown ? !!sig.booking : l.hasBookingHint === true ? true : l.hasBookingHint === false ? false : null;
  if (String(l.phone || '').trim() && booking === false) add('ai', 20, 'van telefon, nincs online foglalás');
  if (REACH_COMPLAINT.test(`${l.aiPainPoints || ''} ${l.aiSummary || ''}`)) add('ai', 20, 'az értékelések elérhetőségi panaszt említenek');

  // towards social media
  if (category && matches(category, CATEGORY_TABLE.social)) add('social', 30, 'látványkategória');
  if (reviews !== null && rating !== null && reviews < 30 && rating >= 4.5) add('social', 30, 'kevés értékelés, jó átlag');
  if (sigKnown && !sig.instagram && l.websiteStatus !== 'INSTAGRAM_ONLY') add('social', 15, 'a weboldal nem mutat Instagramra');
  if (l.websiteStatus === 'FACEBOOK_ONLY') add('social', 10, 'csak Facebook-oldala van');
  if (l.websiteStatus === 'UNDER_CONSTRUCTION' || l.websiteStatus === 'DOMAIN_PARKED') add('social', 10, 'a weboldal nem él');

  const clear = ai - social >= MARGIN;
  const close = Math.abs(ai - social) < MARGIN;
  const offer = clear ? 'ai' : 'social';
  const reasons = [...why[offer]];
  if (close) reasons.push('határeset');
  return { offer, score: Math.max(0, Math.min(100, offer === 'ai' ? ai : social)), reasons };
}
