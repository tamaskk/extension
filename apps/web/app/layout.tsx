import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GridLeads — Dashboard',
  description: 'Google Maps lead generation dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
