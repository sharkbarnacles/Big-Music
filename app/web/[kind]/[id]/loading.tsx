// Shown while a YouTube Music page loads. A whole discography can take a
// few seconds the first time (every album gets opened), so say so.
export default function Loading() {
  return (
    <main className="wrap">
      <div className="web-loading">
        <span className="play-spin" aria-hidden="true" />
        <span>Loading from YouTube Music…</span>
        <small>A whole discography takes a few seconds the first time.</small>
      </div>
    </main>
  );
}
