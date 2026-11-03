import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

const LANGS = ['thai', 'chinese', 'korean', 'japanese', 'english', 'other'];

// POST { voice: { thai: 'male' | 'female' | null, … } } — which vocals to
// favour per language in mixes (a gentle lift, never a filter).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const voice: Record<string, string> = {};
  for (const l of LANGS) {
    const v = body?.voice?.[l];
    if (v === 'male' || v === 'female') voice[l] = v;
  }
  const { error } = await db().from('taste_settings').upsert({ key: 'voice', value: voice, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, voice });
}
