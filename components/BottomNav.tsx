'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

// The bar at the bottom of every page: icons only, with a dot under the
// page you're on. Hidden on the login screen.
const ITEMS = [
  { href: '/', label: 'Home', d: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { href: '/library', label: 'Library', d: 'M4 4v16M9 4v16M14 4l6 16' },
  { href: '/library?search=1', label: 'Search', d: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.5-3.5' },
  { href: '/discover', label: 'Discover', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z' },
];

export default function BottomNav() {
  const path = usePathname();
  const params = useSearchParams();
  if (path === '/login') return null;

  const current = (href: string) => {
    if (href === '/library?search=1') return path === '/library' && params.get('search') === '1';
    if (href === '/library') return (path === '/library' && params.get('search') !== '1') || path.startsWith('/playlists');
    if (href === '/') return path === '/' || path === '/choose';
    return path.startsWith(href);
  };

  return (
    <>
      <div className="nav-space" aria-hidden="true" />
      <nav className="bottom-nav" aria-label="Main">
        {ITEMS.map((item) => (
          <Link key={item.label} href={item.href} aria-label={item.label} aria-current={current(item.href) ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={item.d} />
            </svg>
            <i />
          </Link>
        ))}
      </nav>
    </>
  );
}
