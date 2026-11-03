import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

// POST { kind, message?, page?, detail? } — the app's own crash log
// (errors and restarts while music was playing). Read it with
// `select * from client_events order by at desc limit 50;`
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const kind = typeof b.kind === 'string' ? b.kind.slice(0, 40) : '';
  if (!kind) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await db().from('client_events').insert({
    kind,
    message: typeof b.message === 'string' ? b.message.slice(0, 2000) : null,
    page: typeof b.page === 'string' ? b.page.slice(0, 300) : null,
    detail: b.detail && typeof b.detail === 'object' ? b.detail : null,
  });
  return NextResponse.json({ ok: true });
}
