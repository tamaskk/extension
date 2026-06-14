// GridLeads Maps protobuf parser.
// Google Maps' /search RPC returns a giant nested array (XSSI-guarded). Each
// place's detail array has its fields at well-known index paths (name [11],
// website [7][0], phone [178], rating [4][7], reviews [4][8], lat/lng [9][2..3]).
// Reading website here is reliable — unlike the DOM list, where it's absent.
//
// The finder is RECURSIVE so it does not depend on the exact top-level path
// ([0][1] vs [64] etc.): it walks the tree and recognises place arrays by shape.
// Attaches to `self` so the background service worker can importScripts it.
(function (root) {
  function pick(node, path) {
    let cur = node;
    for (const i of path) {
      if (cur == null) return undefined;
      cur = cur[i];
    }
    return cur;
  }

  // Heuristic: is `a` a place-detail array? It has a string name at [11] and a
  // coordinate array at [9] (with lat/lng at [9][2],[9][3]).
  function looksLikePlace(a) {
    return Array.isArray(a)
      && typeof a[11] === 'string' && a[11].length > 0
      && Array.isArray(a[9])
      && typeof a[9][2] === 'number' && typeof a[9][3] === 'number';
  }

  // Recursively collect place-detail arrays from anywhere in the structure.
  function findPlaces(node, out, depth) {
    if (node == null || depth > 14 || out.length > 500) return;
    if (Array.isArray(node)) {
      if (looksLikePlace(node)) { out.push(node); return; } // don't descend into a place
      // common wrapper: entry whose [14] is the place
      if (Array.isArray(node[14]) && looksLikePlace(node[14])) { out.push(node[14]); return; }
      for (const child of node) findPlaces(child, out, depth + 1);
    }
  }

  function parsePlace(place) {
    const name = pick(place, [11]);
    if (!name || typeof name !== 'string') return null;

    const website = pick(place, [7, 0]) || '';
    const cats = pick(place, [13]);
    const category = Array.isArray(cats) ? (cats[0] || '') : '';

    // phones: [178][0] holds a list; each item's [0] is the formatted number.
    let phone = '';
    const phoneBlock = pick(place, [178, 0]);
    if (Array.isArray(phoneBlock)) {
      if (Array.isArray(phoneBlock[1])) {
        const nums = phoneBlock[1].map((p) => (Array.isArray(p) ? p[0] : p)).filter((x) => typeof x === 'string');
        phone = nums[0] || '';
      } else if (typeof phoneBlock[0] === 'string') {
        phone = phoneBlock[0];
      }
    }

    const placeId = pick(place, [78]) || '';
    const cidRaw = pick(place, [10]);
    const cid = (typeof cidRaw === 'string') ? cidRaw : '';
    const lat = pick(place, [9, 2]) ?? null;
    const lng = pick(place, [9, 3]) ?? null;
    const rating = pick(place, [4, 7]);
    const reviewCount = pick(place, [4, 8]);
    const address = pick(place, [39]) || pick(place, [18]) || '';

    const dedupKey = placeId || cid || `${name}|${lat}|${lng}`;
    return {
      placeId: placeId || '',
      cid,
      dedupKey,
      name,
      category: typeof category === 'string' ? category : '',
      rating: typeof rating === 'number' ? Math.round(rating * 10) / 10 : null,
      reviewCount: typeof reviewCount === 'number' ? reviewCount : null,
      phone: phone || '',
      website: typeof website === 'string' ? website : '',
      email: '',
      address: typeof address === 'string' ? address : '',
      lat, lng,
      mapsUrl: cid ? `https://www.google.com/maps?cid=${cid}`
        : (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : ''),
      hasBookingHint: null,
      scrapedAt: new Date().toISOString(),
    };
  }

  function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

  // Google's Maps RPC streams a sequence of {"c":N,"d":"<payload>"} objects, so
  // the whole body is NOT valid JSON. The place data lives inside the "d" string
  // fields (XSSI-guarded with )]}' and JSON-escaped). Extract each "d" token
  // (fast, slice-based), JSON-decode it, strip )]}' and parse the array.
  function extractDStrings(text) {
    const out = [];
    let idx = 0;
    while (true) {
      const start = text.indexOf('"d":"', idx);
      if (start < 0) break;
      let i = start + 5;
      while (i < text.length) {
        const ch = text.charCodeAt(i);
        if (ch === 92) { i += 2; continue; } // backslash → skip escaped char
        if (ch === 34) break;                 // unescaped quote → end of string
        i++;
      }
      out.push(text.slice(start + 5, i)); // still JSON-escaped content
      idx = i + 1;
    }
    return out;
  }

  function stripGuard(s) {
    return s.replace(/^\)\]\}'/, '').replace(/^\s+/, '');
  }

  // Strip Google's XSSI guards / wrapper and JSON.parse, trying several formats.
  function unwrap(text) {
    const t = String(text).trim();

    // Primary: streaming envelope — decode each "d" payload, parse the one(s)
    // that carry the array. The first chunk usually holds the whole page.
    const tokens = extractDStrings(t);
    if (tokens.length) {
      const decoded = tokens.map((tok) => tryParse('"' + tok + '"')).filter((s) => typeof s === 'string');
      // try each decoded payload alone (most often the first has everything)
      for (const d of decoded) {
        const arr = tryParse(stripGuard(d));
        if (arr) return arr;
      }
      // fallback: maybe the array is split across chunks — concatenate them
      const joined = stripGuard(decoded.join(''));
      const arr = tryParse(joined);
      if (arr) return arr;
    }

    // Fallbacks for non-streaming variants
    let body = t.startsWith('/*""*/') ? t.slice(6).trim() : t;
    const whole = tryParse(body);
    if (whole && typeof whole === 'object') {
      if (typeof whole.d === 'string') { const a = tryParse(stripGuard(whole.d)); if (a) return a; }
      return whole;
    }
    const stripped = tryParse(stripGuard(body));
    if (stripped) return stripped;
    const i = body.indexOf('[');
    if (i >= 0) { const a = tryParse(body.slice(i)); if (a) return a; }
    return null;
  }

  function parseSearchResponse(text) {
    const parsed = unwrap(text);
    if (parsed == null) {
      root.__gridleadsDebug = { stage: 'unwrap-failed', prefix: String(text).slice(0, 60), len: String(text).length };
      return [];
    }
    const out = [];
    findPlaces(parsed, out, 0);
    root.__gridleadsDebug = {
      stage: 'parsed',
      topIsArray: Array.isArray(parsed),
      topLen: Array.isArray(parsed) ? parsed.length : Object.keys(parsed || {}).length,
      placesFound: out.length,
      prefix: String(text).slice(0, 40),
    };
    return out.map(parsePlace).filter(Boolean);
  }

  root.GridLeadsParser = { parsePlace, findPlaces, unwrap, parseSearchResponse };
})(typeof self !== 'undefined' ? self : this);
