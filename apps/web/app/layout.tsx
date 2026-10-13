import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GridLeads — Dashboard',
  description: 'Google Maps lead generation dashboard',
};

// Fixed text, no user input. localStorage can be blocked; then the page stays light.
const THEME_SCRIPT = "try{if(localStorage.getItem('gridleads_theme')==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}";

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the script below sets data-theme before React sees the page, so the attribute differs from the server's
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The stored theme, applied before the first paint: read after it, a dark page would flash white on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
