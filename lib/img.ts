// Smaller versions of cover images for places that show them small.
// Spotify and YouTube store covers at 640px or more; a phone decodes each one
// into memory at full size, so hundreds of full-size covers in a long list can
// make iOS shut the home-screen app down (the player "crashes"). These hosts
// all offer smaller copies of the same picture at a different address.
export function smallCover(url: string | null | undefined, size: 'row' | 'tile' = 'row'): string | undefined {
  if (!url) return undefined;
  // Spotify album art: 640 (b273) → 300 (1e02). 300 is the smallest that stays sharp on an iPhone.
  if (url.includes('i.scdn.co/image/ab67616d0000b273')) return url.replace('ab67616d0000b273', 'ab67616d00001e02');
  // Spotify playlist mosaics and artist pictures.
  if (url.includes('mosaic.scdn.co/640/')) return url.replace('mosaic.scdn.co/640/', 'mosaic.scdn.co/300/');
  if (url.includes('i.scdn.co/image/ab6761610000e5eb')) return url.replace('ab6761610000e5eb', 'ab67616100005174');
  // YouTube Music / Google images: ask for the exact size.
  const px = size === 'row' ? 150 : 300;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+/, `=s${px}`);
  }
  // YouTube video thumbnails: 320×180 instead of 480×360 or bigger.
  const yt = url.match(/i\.ytimg\.com\/vi\/([\w-]+)\//);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`;
  return url;
}
