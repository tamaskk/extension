// Where to put each country and US state on the place picker's map, and which
// clock it keeps. Pure data plus one lookup.
//
// The points are rough centres, good for a label on a map and for
// timezoneFromCoords; they are not used for anything that needs a border.
import { timezoneFromCoords } from './timezoneFromCoords.mjs';

// [lat, lng]. A country with several clocks sits where most of its leads are.
/** @type {Record<string, [number, number]>} */
export const COUNTRY_CENTERS = {
  Austria: [47.6, 14.1], Belgium: [50.6, 4.6], Canada: [45.4, -75.7], France: [46.6, 2.4], Greece: [39.0, 22.0],
  'Hong Kong': [22.3, 114.2], Hungary: [47.2, 19.5], Italy: [42.8, 12.5], Netherlands: [52.2, 5.3], Portugal: [39.6, -8.0],
  Spain: [40.2, -3.6], Switzerland: [46.8, 8.2], Taipei: [25.03, 121.56], UK: [53.0, -1.5], USA: [39.8, -98.5],
};

/** @type {Record<string, [number, number]>} */
export const STATE_CENTERS = {
  Alabama: [32.8, -86.8], Alaska: [64.0, -152.0], Arizona: [34.2, -111.7], Arkansas: [34.9, -92.4], California: [37.2, -119.4],
  Colorado: [39.0, -105.5], Connecticut: [41.6, -72.7], Delaware: [39.0, -75.5], 'District of Columbia': [38.9, -77.0], Florida: [28.6, -82.4],
  Georgia: [32.7, -83.4], Hawaii: [20.8, -156.3], Idaho: [44.4, -114.6], Illinois: [40.0, -89.2], Indiana: [39.9, -86.3],
  Iowa: [42.1, -93.5], Kansas: [38.5, -98.4], Kentucky: [37.5, -85.3], Louisiana: [31.1, -92.0], Maine: [45.4, -69.2],
  Maryland: [39.0, -76.8], Massachusetts: [42.3, -71.8], Michigan: [44.3, -85.4], Minnesota: [46.3, -94.3], Mississippi: [32.7, -89.7],
  Missouri: [38.4, -92.5], Montana: [47.0, -109.6], Nebraska: [41.5, -99.8], Nevada: [39.3, -116.6], 'New Hampshire': [43.7, -71.6],
  'New Jersey': [40.2, -74.7], 'New Mexico': [34.4, -106.1], 'New York': [42.9, -75.5], 'North Carolina': [35.6, -79.4], 'North Dakota': [47.5, -100.5],
  Ohio: [40.3, -82.8], Oklahoma: [35.6, -97.5], Oregon: [43.9, -120.6], Pennsylvania: [40.9, -77.8], 'Rhode Island': [41.7, -71.5],
  'South Carolina': [33.9, -80.9], 'South Dakota': [44.4, -100.2], Tennessee: [35.9, -86.4], Texas: [31.5, -99.3], Utah: [39.3, -111.7],
  Vermont: [44.1, -72.7], Virginia: [37.5, -78.9], Washington: [47.4, -120.5], 'West Virginia': [38.6, -80.6], Wisconsin: [44.6, -89.9],
  Wyoming: [43.0, -107.5],
};

// The IANA zone of a country or one of its US states; '' when it is not on the map.
export function zoneOfPlace(country, state = '') {
  const at = state ? STATE_CENTERS[state] : COUNTRY_CENTERS[country];
  return at ? timezoneFromCoords(at[0], at[1], country) : '';
}

// "Tue 09:32" on the clock of `zone`; '' for no zone or one the runtime does not know.
export function clockIn(zone, now = new Date()) {
  if (!zone) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).replace(',', '');
  } catch {
    return ''; // an unknown zone has no clock to show
  }
}
