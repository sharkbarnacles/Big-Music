import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { importSpotify } from '@/lib/importers/spotify';

// Lets the GitHub job ".github/workflows/import-resume.yml" carry on an
// unfinished Spotify import in the background, with nobody logged in.
//
// Proof it's really that job, without adding any new secret: the job signs
// the current time with SUPABASE_SECRET_KEY (which both GitHub and Vercel
// already have) and sends only the signature, never the key itself.
export const maxDuration = 300;

function validSignature(time: string | null, sig: string | null): boolean {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key || !time || !sig || !/^\d+$/.test(time)) return false;
  if (Math.abs(Date.now() / 1000 - Number(time)) > 300) return false; // older than 5 minutes
  const expected = createHmac('sha256', key).update(`import:${time}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!validSignature(req.headers.get('x-job-time'), req.headers.get('x-job-sig'))) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
  }
  try {
    return NextResponse.json(await importSpotify());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
