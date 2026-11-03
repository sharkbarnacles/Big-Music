// Tidies song titles for display, so long titles stop getting cut off.
// "Drive (feat. Thama)" → title "Drive", feat "Thama".
// Noise that YouTube adds, like "(Official Audio)", is dropped.

const FEAT_BRACKET = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/i;
const FEAT_TAIL = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;
const NOISE = /\s*[([]\s*(?:official\s+)?(?:music\s+)?(?:audio|video|lyrics?|lyric\s+video|visualizer|mv|m\/v)\s*[)\]]/gi;

export function splitTitle(raw: string): { title: string; feat: string | null } {
  let title = raw.replace(NOISE, '').trim();
  let feat: string | null = null;
  const m = title.match(FEAT_BRACKET) ?? title.match(FEAT_TAIL);
  if (m) {
    feat = m[1].trim();
    title = title.replace(m[0], '').trim();
  }
  return { title: title || raw, feat };
}

// The artist line, with any featured artist the artist field doesn't already name.
export function artistLine(artist: string, feat: string | null): string {
  if (!feat) return artist;
  const have = artist.toLowerCase();
  const extra = feat
    .split(/\s*(?:,|&|\band\b|\bx\b)\s*/i)
    .filter((n) => n && !have.includes(n.toLowerCase()));
  return extra.length ? `${artist} · feat. ${extra.join(', ')}` : artist;
}
