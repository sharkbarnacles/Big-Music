import Link from 'next/link';

export default function Header() {
  return (
    <header className="top">
      <Link href="/" className="brand">Music Hub</Link>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/library">Library</Link>
      </nav>
      <form action="/api/logout" method="post">
        <button type="submit">Log out</button>
      </form>
    </header>
  );
}
