'use client';

import { useState } from 'react';

const LANGS: { id: string; label: string }[] = [
  { id: 'thai', label: 'Thai' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'korean', label: 'Korean' },
  { id: 'japanese', label: 'Japanese' },
];
const CHOICES: { id: 'male' | 'either' | 'female'; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'either', label: 'Either' },
  { id: 'female', label: 'Female' },
];

// Which voices to favour per language. A gentle lift in mixes, never a filter.
export default function VoicePrefs({ initial }: { initial: Record<string, string> }) {
  const [voice, setVoice] = useState<Record<string, string>>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const choose = async (lang: string, v: 'male' | 'either' | 'female') => {
    const next = { ...voice };
    if (v === 'either') delete next[lang];
    else next[lang] = v;
    setVoice(next);
    setMsg(null);
    try {
      const res = await fetch('/api/taste/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: next }) });
      if (!res.ok) throw new Error();
      setMsg('Saved. New radios use it.');
    } catch {
      setMsg('Couldn’t save. Try again.');
      setVoice(voice);
    }
  };
  return (
    <div className="t-voice">
      {LANGS.map((l) => {
        const now = voice[l.id] ?? 'either';
        return (
          <div key={l.id} className="t-voice-row">
            <span>{l.label}</span>
            <div className="d-dial t-dial" role="radiogroup" aria-label={`${l.label} vocals`}>
              {CHOICES.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={now === c.id} onClick={() => choose(l.id, c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  );
}
