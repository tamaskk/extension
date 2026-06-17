// Build a "create event" Google Calendar URL — opens a pre-filled event the user
// saves with one click (no OAuth needed).
function ymd(d: Date) { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; }
function stampLocal(d: Date) { const p = (n: number) => String(n).padStart(2, '0'); return `${ymd(d)}T${p(d.getHours())}${p(d.getMinutes())}00`; }

// `when` is either a date (YYYY-MM-DD → all-day) or a datetime (YYYY-MM-DDTHH:MM → timed).
export function googleCalendarUrl(opts: { title: string; when: string; durationMin?: number; details?: string; location?: string }): string {
  const { title, when, durationMin = 60, details, location } = opts;
  if (!when) return '';
  let dates: string;
  if (when.includes('T')) {
    const [datePart, timePart] = when.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm || 0);
    const end = new Date(start.getTime() + durationMin * 60000);
    dates = `${stampLocal(start)}/${stampLocal(end)}`;
  } else {
    const [y, m, d] = when.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(start.getTime() + 86400000); // all-day → next day
    dates = `${ymd(start)}/${ymd(end)}`;
  }
  const p = new URLSearchParams();
  p.set('action', 'TEMPLATE');
  p.set('text', title);
  p.set('dates', dates);
  if (details) p.set('details', details);
  if (location) p.set('location', location);
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

// A readable event description from a lead-ish object.
export function calDetails(r: { phone?: string; email?: string; website?: string; mapsUrl?: string; category?: string; rating?: number | null; reviewCount?: number | null; opportunityScore?: number; _project?: string }): string {
  return [
    r.category && `Category: ${r.category}`,
    r.rating != null && `Rating: ★${r.rating}${r.reviewCount != null ? ` (${r.reviewCount})` : ''}`,
    r.phone && `Phone: ${r.phone}`,
    r.email && `Email: ${r.email}`,
    r.website ? `Website: ${r.website}` : 'No website',
    r.opportunityScore != null && `Opportunity: ${r.opportunityScore}`,
    r.mapsUrl && `Maps: ${r.mapsUrl}`,
    r._project && `Project: ${r._project}`,
  ].filter(Boolean).join('\n');
}
