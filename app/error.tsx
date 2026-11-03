'use client';

// If a page fails to load (for example a slow moment in the database while the
// page refreshes after adding to a playlist), only that page shows this message.
// The player lives outside the page, so your music keeps playing.
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap">
      <div className="notice" style={{ marginTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
        <p style={{ margin: '0 0 10px' }}>This page didn’t load properly. Your music is still playing.</p>
        <button type="button" className="primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
