import type { MetadataRoute } from 'next';

// The home-screen app's name and icon (App Icon Lab pick M1 + B2 + N1:
// the spiral on deep water, named "Music Hub").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Music Hub',
    short_name: 'Music Hub',
    start_url: '/',
    display: 'standalone',
    background_color: '#04141A',
    theme_color: '#04141A',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
