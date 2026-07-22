import type { Metadata } from 'next';
import { Schibsted_Grotesk, Instrument_Sans, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';

const display = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-display' });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body' });
const mono = Spline_Sans_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'GridLeads — Smarter Leads, Stronger Sales',
  description: 'Live overview of the GridLeads database: total leads, leads without a website and hot leads.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
