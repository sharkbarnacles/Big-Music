'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Tag } from '@/lib/tagTypes';
import TagSheet from './TagSheet';

// Tag pills under a playlist's name (Home Lab pick E3): tap a pill to take
// that tag off, "+ Tag" opens the Tags window to add or make one.
export default function PlaylistTags({
  playlistId,
  name,
  initial,
  tags,
}: {
  playlistId: string;
  name: string;
  initial: string[];
  tags: Tag[];
}) {
  const router = useRouter();
  const [mine, setMine] = useState<string[]>(initial);
  const [known, setKnown] = useState<Tag[]>(tags);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(known.map((t) => [t.id, t]));

  const change = (tag: Tag, on: boolean) => {
    setKnown((old) => (old.some((t) => t.id === tag.id) ? old : [...old, tag].sort((a, b) => a.name.localeCompare(b.name))));
    setMine((old) => (on ? (old.includes(tag.id) ? old : [...old, tag.id]) : old.filter((t) => t !== tag.id)));
  };
  const remove = async (tag: Tag) => {
    setError(null);
    change(tag, false);
    try {
      const res = await fetch('/api/playlists/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [playlistId], tag: tag.id, on: false }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) {
      change(tag, true);
      setError((e as Error).message || 'Couldn’t remove that tag. Try again.');
    }
  };

  const shown = mine.map((id) => byId.get(id)).filter(Boolean) as Tag[];
  return (
    <>
      <div className="pl-tags" aria-label="Tags">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tag-pill tag-${t.color}`}
            aria-label={`Remove tag ${t.name}`}
            onClick={() => remove(t)}
          >
            {t.name} <span className="x" aria-hidden="true">×</span>
          </button>
        ))}
        <button type="button" className="tag-add" onClick={() => setOpen(true)}>
          + Tag
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {open && (
        <TagSheet
          playlistIds={[playlistId]}
          what={name}
          tags={known}
          assigned={{ [playlistId]: mine }}
          onChange={change}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
