import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Shell from '@/components/Shell';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'TokenLeads',
  description: 'Token-alapú lead piactér — keresés, feloldás, kontakt.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#6366f1' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className={jakarta.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
