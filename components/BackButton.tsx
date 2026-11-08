'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

// "‹ Back": goes to the page you came from (an artist page, a search, a
// discography…), like a phone's back button. Opened fresh with nothing
// before it (e.g. right after the app starts), it goes to `fallback`.
export default function BackButton({ fallback, label = 'Back' }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className="muted small d-back"
      onClick={(e) => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      ‹ {label}
    </Link>
  );
}
