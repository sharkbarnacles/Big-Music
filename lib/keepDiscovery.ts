// Discover songs aren't in your library until you keep them, so the player
// knows them by a temporary ID: "disc:<discover item id>". This turns such an
// ID into a real song in your library (saving it once), so it can go into
// any playlist. Ordinary song IDs pass straight through.
import { db } from './db';
import { saveTracks } from './library';

export async function keepDiscoveryItem(itemId: string): Promise<string> {
  const { data: item } = await db()
    .from('discover_items')
    .select('id, track_id, yt_video_id, title, artist, album, image_url, duration_ms')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) throw new Error('That Discover song can’t be found any more.');
  if (item.track_id) return item.track_id as string;
  if (!item.yt_video_id) throw new Error('This song has no YouTube version to keep.');

  const map = await saveTracks([
    {
      service: 'youtube',
      externalId: item.yt_video_id,
      url: `https://music.youtube.com/watch?v=${item.yt_video_id}`,
      title: item.title,
      artist: item.artist,
      album: item.album,
      durationMs: item.duration_ms,
      isrc: null,
      imageUrl: item.image_url,
    },
  ]);
  const trackId = map.get(item.yt_video_id);
  if (!trackId) throw new Error('Could not save the song.');
  // It plays in YouTube mode straight away, from the same video.
  await db()
    .from('tracks')
    .update({ yt_audio_id: item.yt_video_id, yt_audio_status: 'found', yt_audio_source: 'library', yt_audio_checked_at: new Date().toISOString() })
    .eq('id', trackId)
    .is('yt_audio_id', null);
  await db().from('discover_items').update({ track_id: trackId }).eq('id', itemId);
  return trackId;
}

// Swaps any "disc:…" IDs in a list for real song IDs.
export async function resolveTrackIds(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    if (id.startsWith('disc:')) out.push(await keepDiscoveryItem(id.slice(5)));
    else out.push(id);
  }
  return out;
}
