// Leaflet for the two maps of the dashboard, loaded from unpkg on first use
// (docs/ARCHITECTURE.md lists it as one of the two third parties the browser
// calls). Browser only. After it resolves, the library is at `window.L`.

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

function loadCss(href: string) {
  return new Promise<void>((res) => {
    if (document.querySelector(`link[href="${href}"]`)) return res();
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => res(); l.onerror = () => res();
    document.head.appendChild(l);
  });
}
function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

export async function loadLeaflet(): Promise<void> {
  await loadCss(LEAFLET_CSS);
  await loadScript(LEAFLET_JS);
  // the tag can exist while the script is still loading (two maps opened at once): wait for the library itself
  for (let i = 0; i < 100 && !(window as unknown as { L?: unknown }).L; i++) await new Promise((r) => setTimeout(r, 50));
  if (!(window as unknown as { L?: unknown }).L) throw new Error('Leaflet did not load');
}
