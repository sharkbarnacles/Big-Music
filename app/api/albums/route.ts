import { NextResponse, type NextRequest } from 'next/server';
import { ALBUM_ID, isAlbumSaved, loadSavedAlbums, saveAlbum, unsaveAlbum } from '@/lib/savedAlbums';

export const dynamic = 'force-dynamic';

// Saved albums.
//   GET               every saved album (the "Albums" chip)
//   GET ?id=MPRE…     { saved } for one album (its star)
//   POST {id,title,artist,subtitle,image,count}   star it
//   DELETE {id}       unstar it
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    if (!ALBUM_ID.test(id)) return NextResponse.json({ error: 'Not an album.' }, { status: 400 });
    return NextResponse.json({ saved: await isAlbumSaved(id) });
  }
  const { albums, error } = await loadSavedAlbums();
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ albums });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? '');
  const title = String(b.title ?? '').trim();
  if (!ALBUM_ID.test(id) || !title) return NextResponse.json({ error: 'Not an album.' }, { status: 400 });
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);
  const img = str(b.image);
  try {
    await saveAlbum({
      browse_id: id,
      title: title.slice(0, 300),
      artist: str(b.artist),
      subtitle: str(b.subtitle),
      image_url: img && /^https:\/\//.test(img) ? img : null,
      song_count: Number.isFinite(Number(b.count)) ? Number(b.count) : null,
    });
    return NextResponse.json({ saved: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? '');
  if (!ALBUM_ID.test(id)) return NextResponse.json({ error: 'Not an album.' }, { status: 400 });
  try {
    await unsaveAlbum(id);
    return NextResponse.json({ saved: false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
