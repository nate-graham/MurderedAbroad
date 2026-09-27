import type { Metadata, Viewport } from 'next';
import { Newsreader, Public_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// next/font downloads these at build time and serves them from this site, so pages make
// no requests to Google and the font-src 'self' policy holds.
const serif = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
});

const sans = Public_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Support Assistant',
  description: 'Guidance for families affected by murder or manslaughter abroad.',
};

// viewport-fit=cover makes the safe-area insets available to CSS. Zoom stays enabled.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#faf9f7',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${serif.variable} ${sans.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
