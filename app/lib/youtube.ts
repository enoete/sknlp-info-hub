// Appends a YouTube start-time parameter when we actually have one — real
// per-claim second offsets from transcript_segments.start_seconds, never
// guessed. Every citation URL in the app should go through this rather
// than linking the bare video, once a segment link exists.
export function withTimestamp(url: string, seconds: number | null | undefined): string {
  if (seconds == null) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.max(0, Math.floor(seconds))}s`;
}

function formatMinutesSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// "Read source" reads wrong on a YouTube citation — you watch a video, you
// don't read it. Label the citation link by what it actually is: a real
// timestamp on a video link becomes "Watch at M:SS", a video link with no
// timestamp becomes "Watch source", and anything else (an article, a PDF,
// a press release) stays "Read source". Works off the URL itself rather
// than a separate stored field, so it can't drift out of sync with what
// withTimestamp() already deep-linked.
export function sourceLinkLabel(url: string | null | undefined): string {
  if (!url) return 'View source';
  const isVideo = /youtube\.com|youtu\.be/i.test(url);
  if (!isVideo) return 'Read source';

  const match = url.match(/[?&]t=(\d+)s?/);
  if (!match) return 'Watch source';
  return `Watch at ${formatMinutesSeconds(Number(match[1]))}`;
}
