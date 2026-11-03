// Sends a note to the app's crash log (table client_events). Never throws.
let sent = 0;
export function clientLog(kind: string, message?: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined' || sent++ > 20) return;
  try {
    const body = JSON.stringify({ kind, message, page: location.pathname + location.search, detail });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }));
    else fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* logging must never break the app */
  }
}
