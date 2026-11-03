import Link from 'next/link';

// Top of each page. Moving between pages happens in the bottom bar.
export default function Header() {
  return (
    <header className="top">
      <Link href="/" className="brand">Music Hub</Link>
      <form action="/api/logout" method="post">
        <button type="submit">Log out</button>
      </form>
    </header>
  );
}
