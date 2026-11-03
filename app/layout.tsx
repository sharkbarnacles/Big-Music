import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { Suspense } from 'react';
import BottomNav from '@/components/BottomNav';
import { PlayerProvider } from '@/components/Player';
import './globals.css';

// Space Grotesk for Latin text; Korean, Japanese and other scripts fall back
// to the phone's own fonts.
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Music Hub',
  description: 'My Spotify and YouTube Music library in one place',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#04141A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <PlayerProvider>
          {children}
          <Suspense fallback={null}>
            <BottomNav />
          </Suspense>
        </PlayerProvider>
      </body>
    </html>
  );
}
