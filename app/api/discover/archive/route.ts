import { NextResponse, type NextRequest } from 'next/server';
import { editionsInMonth } from '@/lib/discover';

// Editions in one month, for the archive calendar: ?month=2026-11
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Use ?month=YYYY-MM' }, { status: 400 });
  try {
    return NextResponse.json({ editions: await editionsInMonth(month) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
