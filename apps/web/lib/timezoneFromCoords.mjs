// A lead's time zone from its coordinates, without a network call and without
// a dependency. Pure.
//
// An approximation on purpose: rough boxes and border lines for the countries
// the leads come from. An exact lookup is a library of polygons loaded into
// every cold start, and the precise line does not matter here: the send window
// that runs on this zone (lib/sendWindow.mjs) is 12 hours wide, so an hour's
// error next to a zone border disappears in it.
//
// When the place is not known the answer is '', never a guess: a lead without
// a zone is left out of sending, it is not sent to at some random hour.

// [latMin, latMax, lngMin, lngMax, zone], checked in order: small areas first.
const BOXES = [
  [18.5, 22.5, -161, -154, 'Pacific/Honolulu'],
  [51, 72, -180, -129.9, 'America/Anchorage'],
  [22.1, 22.6, 113.8, 114.5, 'Asia/Hong_Kong'],
  [21.8, 25.4, 119.9, 122.1, 'Asia/Taipei'],
  [36.8, 42.2, -9.6, -6.2, 'Europe/Lisbon'],
  [49.8, 61, -10.7, 1.8, 'Europe/London'],
  [34.7, 41.8, 19.3, 28.3, 'Europe/Athens'],
  // the rest of the continent the leads come from keeps one clock, Central European
  [35, 71, -9.4, 24.2, 'Europe/Budapest'],
];

// North America between the Atlantic provinces and the Pacific: the zone
// borders run roughly north to south, at a longitude that shifts with latitude.
function northAmericaZone(lat, lng) {
  if (lat < 24 || lat > 70 || lng < -141 || lng > -52) return '';
  if (lng > -59.5 && lat > 46) return 'America/St_Johns';
  if (lng > -67.5 && lat > 43) return 'America/Halifax';
  // Arizona keeps Mountain Standard Time all year, Saskatchewan Central Standard
  // Time: in summer they are an hour behind Denver and Chicago, so they are zones of their own.
  if (lat >= 31.3 && lat <= 37 && lng >= -114.82 && lng <= -109.05) return 'America/Phoenix';
  if (lat >= 49 && lat <= 60 && lng >= -110 && lng <= -101.4) return 'America/Regina';
  const eastCentral = lat >= 37.5 ? -87.5 : -85.3;
  if (lng > eastCentral) return 'America/New_York';
  const centralMountain = lat >= 36.5 ? -101.5 : lat >= 32 ? -103.05 : -104.9;
  if (lng > centralMountain) return 'America/Chicago';
  const mountainPacific = lat >= 45.5 ? -116.05 : lat >= 42 ? -117.03 : -114.05;
  if (lng > mountainPacific) return 'America/Denver';
  return 'America/Los_Angeles';
}

// Countries that keep one clock: the country alone answers, coordinates or not.
const COUNTRY_ZONES = {
  Hungary: 'Europe/Budapest', Austria: 'Europe/Budapest', Belgium: 'Europe/Budapest', France: 'Europe/Budapest', Italy: 'Europe/Budapest',
  Netherlands: 'Europe/Budapest', Switzerland: 'Europe/Budapest', Greece: 'Europe/Athens', UK: 'Europe/London', 'Hong Kong': 'Asia/Hong_Kong', Taipei: 'Asia/Taipei',
};

// Every zone this lookup can answer with.
export const ZONES = [...new Set([...BOXES.map((b) => b[4]), ...Object.values(COUNTRY_ZONES), 'America/St_Johns', 'America/Halifax', 'America/Phoenix', 'America/Regina', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'])];

// → an IANA zone, or '' when the place is not known. `country` is the country
// of the lead's project as lib/projectGeo.ts names it, when there is one.
// Never throws. 0,0 is what a missing coordinate looks like, not a place.
export function timezoneFromCoords(lat, lng, country) {
  if (country && COUNTRY_ZONES[country]) return COUNTRY_ZONES[country];
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === '' || lng === '') return '';
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return '';
  for (const [latMin, latMax, lngMin, lngMax, zone] of BOXES) if (la >= latMin && la <= latMax && lo >= lngMin && lo <= lngMax) return zone;
  return northAmericaZone(la, lo);
}
