'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Summary = {
  playlists?: number;
  songs?: number;
  excluded?: number;
  unchanged?: number;
  skipped?: { name: string; reason: string }[];
  // Spotify imports run in rounds (each under Vercel's 5-minute limit).
  done?: boolean; // missing = the import finished in one go (YouTube)
  total?: number;
  processed?: number;
  error?: string;
};

const MAX_ROUNDS = 60;

export default function ImportButton({ service, label }: { service: 'spotify' | 'youtube'; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setProgress(null);
    try {
      // Keep asking for the next round until the server says it's done.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await fetch(`/api/import?service=${service}`, { method: 'POST' });
        const data: Summary = await res.json().catch(() => ({ error: `Import stopped (HTTP ${res.status}).` }));
        if (data.error) {
          setResult({ ...data, error: `${data.error} What's done so far is saved: press Import again to carry on.` });
          break;
        }
        if (data.done === false) {
          setProgress(data);
          continue;
        }
        setResult(data);
        break;
      }
      router.refresh(); // reload the page's data to show the new playlists
    } catch {
      setResult({ error: "Lost the connection (the phone may have slept). What's done so far is saved: press Import again to carry on." });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const pct = progress?.total ? Math.round(((progress.processed ?? 0) / progress.total) * 100) : 0;

  return (
    <div>
      <button className="primary" onClick={run} disabled={busy}>
        {busy
          ? progress?.total
            ? `Importing… ${(progress.processed ?? 0).toLocaleString()} of ${progress.total.toLocaleString()} playlists`
            : 'Importing… (keep this screen open)'
          : label}
      </button>
      {busy && progress?.total ? (
        <div className="import-progress" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {result?.error && <div className="notice error small">{result.error}</div>}
      {result && !result.error && (
        <div className="notice small">
          Done. {result.playlists ?? 0} playlists imported or updated, {(result.songs ?? 0).toLocaleString()} songs.
          {result.unchanged ? ` ${result.unchanged.toLocaleString()} unchanged since last time.` : ''}
          {result.excluded ? ` Left out ${result.excluded} non-music or unticked playlists.` : ''}
          {result.skipped && result.skipped.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary>{result.skipped.length} skipped</summary>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.name}: <span className="muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
