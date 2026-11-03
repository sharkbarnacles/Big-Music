import Header from '@/components/Header';

export default function DiscoverPage() {
  return (
    <main className="wrap">
      <Header />
      <h1>Discover</h1>
      <p className="muted" style={{ maxWidth: '60ch' }}>
        Recommendations based on what you listen to are coming here next: songs similar to the one playing, artists like
        the ones you love, and favorites you haven’t played in a while.
      </p>
    </main>
  );
}
