// Fetches the start of a lead's own website, safely, to read a few signals out
// of it (lib/siteSignals.mjs). Server code.
//
// The URL comes from scraped data, so it is not trusted. The address is checked
// at the moment the connection is made, by the very lookup the connection uses:
// checking the name first and fetching afterwards would leave a gap in which
// the name can be pointed somewhere else (DNS rebinding). Redirects are
// followed by hand and each hop goes through the same check; only web ports are
// allowed (lib/netGuard.mjs); only the first part of the page is read. The page
// is used and dropped: nothing of it is stored.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { fetchableUrl, isPublicAddress } from '@/lib/netGuard.mjs';

const MAX_BYTES = 400_000;
const MAX_HOPS = 3;

// The lookup of the connection itself: it hands the socket only addresses that
// are on the public internet, and fails the connection otherwise.
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...(typeof options === 'object' ? options : {}), all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || !list.every((a) => isPublicAddress(a.address))) {
      return callback(Object.assign(new Error('address not allowed'), { code: 'ENOTALLOWED' }), '', 0);
    }
    // the connection asked for all addresses or for one, and gets what it asked for
    if (typeof options === 'object' && options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

type Hop = { html: string } | { next: string } | null;

function getOnce(url: URL, deadline: number): Promise<Hop> {
  return new Promise((resolve) => {
    const left = deadline - Date.now();
    if (left <= 0) return resolve(null);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { lookup: guardedLookup, timeout: left, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GridLeads site check)', Accept: 'text/html' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve(res.headers.location ? { next: res.headers.location } : null);
      }
      if (status < 200 || status >= 300 || !String(res.headers['content-type'] || '').includes('html')) {
        res.resume();
        return resolve(null);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () => resolve({ html: new TextDecoder('utf-8').decode(Buffer.concat(chunks).subarray(0, MAX_BYTES)) });
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= MAX_BYTES) { req.destroy(); done(); }
      });
      res.on('end', done);
      res.on('error', () => resolve(null));
    });
    // a timeout, a refused address or a broken connection: the site could not be read
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// → the first MAX_BYTES of the page as text, or null when the site could not
// be read (not found, not HTML, too slow, or not allowed to be fetched).
export async function fetchSiteHtml(website: string, timeoutMs = 6000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let url = fetchableUrl(website) as URL | null;
  for (let hop = 0; url && hop <= MAX_HOPS; hop++) {
    const r = await getOnce(url, deadline);
    if (!r) return null;
    if ('html' in r) return r.html;
    let next: URL | null = null;
    try {
      next = fetchableUrl(new URL(r.next, url).href) as URL | null;
    } catch {
      next = null; // a Location that is not a URL ends the chain
    }
    url = next;
  }
  return null;
}
