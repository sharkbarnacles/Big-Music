import { NextResponse, type NextRequest } from 'next/server';
import { setHeart } from '@/lib/discover';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.itemId !== 'string') return NextResponse.json({ error: 'Missing song' }, { status: 400 });
  try {
    return NextResponse.json(await setHeart(body.itemId, body.on !== false));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
