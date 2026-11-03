'use client';

import { useEffect, useState } from 'react';

// A small message that pops up above the bottom bar and fades away
// (Home Top Lab pick N2). Used for "Connected Spotify" and sign-in problems.
// It also removes ?connected= / ?error= from the address so a refresh
// doesn't show it again.
export default function FlashToast({ message, error = false }: { message: string; error?: boolean }) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
    const timer = setTimeout(() => setShown(false), error ? 7000 : 3000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!shown) return null;
  return (
    <div className={`flash-toast${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
      {!error && (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
      )}
      <span>{message}</span>
      {error && (
        <button type="button" aria-label="Dismiss" onClick={() => setShown(false)}>✕</button>
      )}
    </div>
  );
}
