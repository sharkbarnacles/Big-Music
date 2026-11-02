'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Summary = {
  playlists?: number;
  songs?: number;
  excluded?: number;
  skipped?: { name: string; reason: string }[];
  error?: string;
};

export default function ImportButton({ service, label }: { service: 'spotify' | 'youtube'; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/import?service=${service}`, { method: 'POST' });
      const data: Summary = await res.json().catch(() => ({ error: `Import failed (HTTP ${res.status})` }));
      setResult(data);
      router.refresh(); // reload the page's data to show the new playlists
    } catch {
      setResult({ error: 'Could not reach the app. Is it still running?' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="primary" onClick={run} disabled={busy}>
        {busy ? 'Importing… (can take a few minutes)' : label}
      </button>
      {result?.error && <div className="notice error small">{result.error}</div>}
      {result && !result.error && (
        <div className="notice small">
          Imported {result.playlists} playlists, {result.songs} songs.
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
