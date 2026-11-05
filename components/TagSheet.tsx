'use client';

import { useState } from 'react';
import type { Tag } from '@/lib/tagTypes';

// The "Tag playlists" window (Home Lab pick E3): opened from Home's Select
// bar (several playlists) or "+ Tag" on a playlist page (one). A box on top
// makes a new tag; below, every tag as a pill. A pill is lit when all the
// chosen playlists have it; tapping it puts it on all of them, or takes it off.
// The window sits near the top so the iPhone keyboard doesn't cover it.

export default function TagSheet({
  playlistIds,
  what,
  tags,
  assigned,
  onChange,
  onClose,
}: {
  playlistIds: string[];
  what: string;
  tags: Tag[];
  assigned: Record<string, string[]>;
  onChange: (tag: Tag, on: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = (tagId: string) => playlistIds.length > 0 && playlistIds.every((id) => assigned[id]?.includes(tagId));
  const some = (tagId: string) => playlistIds.some((id) => assigned[id]?.includes(tagId));

  const send = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/playlists/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: playlistIds, ...body }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      return out as { tag: Tag | null };
    } catch (e) {
      setError((e as Error).message || 'Couldn’t save that. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (tag: Tag) => {
    if (busy) return;
    const on = !all(tag.id);
    onChange(tag, on); // show it at once
    if (!(await send({ tag: tag.id, on }))) onChange(tag, !on);
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    const out = await send({ name: n, on: true });
    if (out?.tag) {
      onChange(out.tag, true);
      setName('');
    }
  };

  return (
    <>
      <button type="button" className="panel-back" aria-label="Close panel" onClick={onClose} />
      <div className="panel-sheet tag-sheet" role="dialog" aria-label="Tag playlists">
        <div className="panel-grab" aria-hidden="true" />
        <div className="picker-top">
          <div className="picker-head">
            <h3>{playlistIds.length === 1 ? 'Tags' : `Tag ${playlistIds.length} playlists`}</h3>
            <p className="small muted picker-what">{what}</p>
          </div>
          <button type="button" className="picker-close primary" onClick={onClose}>
            Done
          </button>
        </div>
        <form className="picker-new" onSubmit={create}>
          <input
            id="new-tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag, like night or gym"
            aria-label="New tag name"
            maxLength={40}
            enterKeyHint="done"
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
        {error && <div className="notice error">{error}</div>}
        {tags.length > 0 ? (
          <div className="tag-cloud">
            {tags.map((t) => {
              const on = all(t.id);
              const partly = !on && some(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`tag-pill tag-${t.color}${partly ? ' partly' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(t)}
                >
                  {on && (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                  )}
                  {t.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>No tags yet. Type one above and tap Add.</p>
        )}
        {playlistIds.length > 1 && (
          <p className="small muted" style={{ margin: 0 }}>
            Lit tags are on all {playlistIds.length}. A dashed tag is on some of them; tap it to add it to all.
          </p>
        )}
      </div>
    </>
  );
}
