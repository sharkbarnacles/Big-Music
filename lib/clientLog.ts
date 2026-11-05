// Sends a note to the app's crash log (table client_events). Never throws.
// At most 20 notes per kind per page load (the Spotify diary gets 80).
const sent: Record<string, number> = {};
export function clientLog(kind: string, message?: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  sent[kind] = (sent[kind] ?? 0) + 1;
  if (sent[kind] > (kind === 'spotify' ? 80 : 20)) return;
  try {
    const body = JSON.stringify({ kind, message, page: location.pathname + location.search, detail });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }));
    else fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* logging must never break the app */
  }
}
