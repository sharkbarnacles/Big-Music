export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap">
      <form className="login" action="/api/login" method="post">
        <h1>Music Hub</h1>
        <input type="password" name="password" placeholder="Password" autoFocus required />
        <button className="primary" type="submit">Log in</button>
        {error && <div className="notice error small">Wrong password.</div>}
      </form>
    </main>
  );
}
