'use client';

import { useRef, useState } from 'react';
import type { TrackRowData } from '@/lib/tracks';
import MoreLoader from './MoreLoader';
import TrackList from './TrackList';

// Library songs: the first page comes from the server, the rest loads as
// you scroll. (The page gives it a `key` per search, so a new search starts fresh.) Tapping a song plays on through the whole list.
export default function LibraryList({
  initial,
  total,
  query,
  video = false,
}: {
  initial: TrackRowData[];
  total: number;
  query: string;
  video?: boolean;
}) {
  const [tracks, setTracks] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const more = async () => {
    if (busy.current || tracks.length >= total) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/tracks?${query}&offset=${tracks.length}&limit=200`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const got: TrackRowData[] = body.tracks ?? [];
      setTracks((t) => (got.length ? [...t, ...got] : t));
      if (!got.length) setError('No more songs came back.');
    } catch (e) {
      setError((e as Error).message || 'error');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <TrackList tracks={tracks} video={video} source={{ query, total }} />
      {tracks.length < total && <MoreLoader onVisible={more} loading={loading} error={error} />}
    </>
  );
}
