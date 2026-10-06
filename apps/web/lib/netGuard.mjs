// Is an address somewhere on the public internet? Pure.
//
// The server fetches the websites of leads, and those URLs come from scraped
// data. A URL that points at the machine itself or at a private network must
// never be fetched: on a hosted function that is other tenants' metadata, on
// the operator's own machine it is their router and their local services.

// IPv4 or IPv6, as text → true only for an address that is routable in public.
export function isPublicAddress(ip) {
  const a = String(ip || '').trim().toLowerCase();
  if (!a) return false;
  // an IPv4 address carried inside an IPv6 one
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    if ([x, y, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    if (x === 0 || x === 10 || x === 127 || x >= 224) return false;           // this network, private, loopback, multicast and reserved
    if (x === 169 && y === 254) return false;                                 // link-local, cloud metadata
    if (x === 172 && y >= 16 && y <= 31) return false;                        // private
    if (x === 192 && y === 168) return false;                                 // private
    if (x === 100 && y >= 64 && y <= 127) return false;                       // carrier-grade NAT
    if (x === 198 && (y === 18 || y === 19)) return false;                    // benchmarking
    if (x === 192 && y === 0 && Number(v4[3]) === 0) return false;            // protocol assignments
    return true;
  }
  if (!a.includes(':')) return false;
  if (a === '::' || a === '::1') return false;                                // unspecified, loopback
  if (/^f[cd]/.test(a) || /^fe[89a-f]/.test(a) || /^ff/.test(a)) return false; // unique local, link-local, site-local, multicast
  if (a.startsWith('64:ff9b:')) return false;                                 // IPv4 reached through translation
  // an IPv4 address written in hex inside an IPv6 one (::ffff:7f00:1 is 127.0.0.1)
  const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
  return true;
}

// A URL worth fetching at all: http or https, a host name (not a bare address,
// not localhost), no credentials in it. → the URL object, or null.
export function fetchableUrl(raw) {
  let u;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(String(raw || '')) ? String(raw) : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  // a website is on the web ports; any other port is somebody's service, not a page
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  return u;
}
