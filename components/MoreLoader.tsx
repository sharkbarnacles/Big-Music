'use client';

import { useEffect, useRef } from 'react';

// An invisible marker at the bottom of a list: when it scrolls into view
// (or close to it), `onVisible` loads the next page.
export default function MoreLoader({ onVisible, loading, error }: { onVisible: () => void; loading: boolean; error: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="more-loader">
      {error ? (
        <button type="button" className="btn" onClick={onVisible}>
          Couldn’t load more. Tap to try again.
        </button>
      ) : loading ? (
        <span className="small muted">Loading more…</span>
      ) : null}
    </div>
  );
}
