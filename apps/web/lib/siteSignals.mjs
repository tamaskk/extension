// What a business's own website says about how it works, read from its HTML:
// does it take bookings online, orders online, and does it point at an
// Instagram account. Pure: HTML in, three short values out. The HTML itself is
// never stored.

// name → what gives the engine away in a page's source
const BOOKING = {
  Calendly: /calendly\.com/i,
  Booksy: /booksy\.com/i,
  OpenTable: /opentable\.(com|co\.uk|hu)/i,
  Square: /squareup\.com\/appointments|square\.site\/book|app\.squareup\.com\/appointments/i,
  Fresha: /fresha\.com/i,
  Acuity: /acuityscheduling\.com|squarespacescheduling\.com/i,
  SimplyBook: /simplybook\.(me|it)/i,
  Setmore: /setmore\.com/i,
  Vagaro: /vagaro\.com/i,
  Mindbody: /mindbodyonline\.com|mindbody\.io/i,
  Resy: /resy\.com/i,
  Salonic: /salonic\.hu/i,
  Bookio: /bookio\.com/i,
};
const ORDERING = {
  Wolt: /wolt\.com/i,
  Foodora: /foodora\.(hu|com|at)|foodpanda/i,
  'Uber Eats': /ubereats\.com/i,
  DoorDash: /doordash\.com/i,
  Grubhub: /grubhub\.com/i,
  ChowNow: /chownow\.com/i,
  Toast: /toasttab\.com|order\.toasttab/i,
  'Square Online': /square\.site(?!\/book)/i,
  Shopify: /cdn\.shopify\.com|myshopify\.com/i,
  WooCommerce: /woocommerce/i,
};
// instagram.com/<handle>, not a post, a reel or Instagram's own pages
const INSTAGRAM = /instagram\.com\/(?!p\/|reel\/|reels\/|explore\/|accounts\/|stories\/|tv\/|share\/|about\/|developer\/)([a-z0-9._]{2,30})\/?(?=["'?#\s<]|$)/i;

const firstMatch = (table, html) => { for (const [name, pattern] of Object.entries(table)) if (pattern.test(html)) return name; return ''; };

// → { booking, ordering, instagram }: the name of the booking engine found, the
// name of the ordering service found, the Instagram handle the site links to.
// Each '' when the page shows none.
export function siteSignals(html) {
  const h = String(html || '');
  const handle = h.match(INSTAGRAM);
  return {
    booking: firstMatch(BOOKING, h),
    ordering: firstMatch(ORDERING, h),
    instagram: handle ? handle[1].toLowerCase().replace(/\.$/, '') : '',
  };
}
