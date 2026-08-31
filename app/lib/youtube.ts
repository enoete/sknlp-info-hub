// Appends a YouTube start-time parameter when we actually have one — real
// per-claim second offsets from transcript_segments.start_seconds, never
// guessed. Every citation URL in the app should go through this rather
// than linking the bare video, once a segment link exists.
export function withTimestamp(url: string, seconds: number | null | undefined): string {
  if (seconds == null) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.max(0, Math.floor(seconds))}s`;
}
