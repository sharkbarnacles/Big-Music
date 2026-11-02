'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// A button that calls a server route and shows the `message` (or `error`) it returns.
export default function ActionButton({ url, label, busyLabel }: { url: string; label: string; busyLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message?: string; error?: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      setResult(await res.json().catch(() => ({ error: `Failed (HTTP ${res.status})` })));
      router.refresh();
    } catch {
      setResult({ error: 'Could not reach the app. Is it still running?' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={run} disabled={busy}>{busy ? busyLabel : label}</button>
      {result?.error && <div className="notice error small">{result.error}</div>}
      {result?.message && <div className="notice small">{result.message}</div>}
    </div>
  );
}
