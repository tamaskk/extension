// Where to send the operator after login. The `next` query parameter comes
// from the URL, so anyone can craft a login link with it: only a path on this
// site is followed. Browsers read a backslash as a slash and drop tabs and
// newlines, so "/\evil.example" and "/<tab>/evil.example" would both leave the
// site; those are refused too.
export function localPath(next) {
  const s = typeof next === 'string' ? next : '';
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f\u007f]/.test(s)) return '/';
  return s;
}
