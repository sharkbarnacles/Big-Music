import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { Suspense } from 'react';
import BottomNav from '@/components/BottomNav';
import { PlaylistPickerProvider } from '@/components/PlaylistPicker';
import { PlayerProvider } from '@/components/Player';
import './globals.css';

// Space Grotesk for Latin text; Korean, Japanese and other scripts fall back
// to the phone's own fonts.
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Music Hub',
  description: 'My Spotify and YouTube Music library in one place',
  // Home-screen web app: full screen, page runs behind the status bar
  // (the strip in globals.css keeps the clock area solid).
  appleWebApp: { capable: true, title: 'Music Hub', statusBarStyle: 'black-translucent' },
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
        <PlaylistPickerProvider>
          <PlayerProvider>
            {children}
            <Suspense fallback={null}>
              <BottomNav />
            </Suspense>
          </PlayerProvider>
        </PlaylistPickerProvider>
      </body>
    </html>
  );
}
