import { getConnection } from '@/lib/connections';
import HeaderBar from './HeaderBar';

// Top of each page (Home Top Lab pick H2 + V3): a small "Music Hub" label,
// a Services button whose two dots show each service's status, and an
// Account button. Looks up whether each service is connected.
export default async function Header() {
  const [spotify, youtube] = await Promise.all([
    getConnection('spotify').catch(() => null),
    getConnection('youtube').catch(() => null),
  ]);
  return (
    <HeaderBar
      spotify={spotify ? { account: spotify.account_name } : null}
      youtube={youtube ? { account: youtube.account_name } : null}
    />
  );
}
