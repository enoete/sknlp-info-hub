// Pure, DB-free constants shared between the server (app/lib/sourceManager.ts,
// the API route) and the client ('use client' AddSourceForm.tsx). Must stay
// free of any import that reaches app/lib/db.ts — importing 'pg' into a
// client component pulls in Node's 'tls' module and breaks the webpack
// build ("Module not found: Can't resolve 'tls'"), which is exactly what
// happened the first time this lived in the same file as createSource().

export const SOURCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'official_party', label: 'Official — SKNLP' },
  { value: 'official_govt', label: 'Official — Government' },
  { value: 'opposition', label: 'Opposition figure/party' },
  { value: 'press', label: 'Press' },
  { value: 'third_party', label: 'Third party' }
];

export const ADD_SOURCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'youtube_channel', label: 'YouTube channel (ongoing)' },
  { value: 'website', label: 'Website / news feed (ongoing)' },
  { value: 'single_video', label: 'Single video URL (one-off)' },
  { value: 'image_upload', label: 'Image upload (one-off)' },
  { value: 'paste_text', label: 'Paste text (one-off)' },
  { value: 'other', label: 'Other' }
];

export const VALID_SOURCE_TYPES = new Set(SOURCE_TYPE_OPTIONS.map((o) => o.value));
export const VALID_ADD_SOURCE_TYPES = new Set(ADD_SOURCE_TYPE_OPTIONS.map((o) => o.value));

export type ContentFieldKind = 'url' | 'text' | 'textarea' | 'file';

export interface ContentFieldConfig {
  kind: ContentFieldKind;
  label: string;
  placeholder?: string;
}

// Drives AddSourceForm's content field per Type. Stage 2 still only ever
// writes one string into sources_registry.handle_or_url — there's no
// source_attachments/proof_documents write in this stage yet — so 'file'
// kind stores just the selected filename (nothing is actually uploaded or
// persisted), and 'textarea' stores the pasted text verbatim as that
// string. Both are honest stopgaps until real content storage exists,
// not a claim that the content itself is captured.
export const CONTENT_FIELD_CONFIG: Record<string, ContentFieldConfig> = {
  youtube_channel: { kind: 'url', label: 'URL or handle', placeholder: 'https://www.youtube.com/@example' },
  website: { kind: 'url', label: 'URL', placeholder: 'https://example.com/news' },
  single_video: { kind: 'url', label: 'Video URL', placeholder: 'https://www.youtube.com/watch?v=...' },
  image_upload: { kind: 'file', label: 'Image file' },
  paste_text: { kind: 'textarea', label: 'Pasted text', placeholder: 'Paste the post/article text here' },
  other: { kind: 'text', label: 'URL or handle', placeholder: 'https://... or a reference' }
};

// Handles already confirmed as our own in seed/seed-sources-registry.sql
// (tier='owned' rows). Matched against whatever the person types — a bare
// handle or a full youtube.com URL both contain the @handle substring.
const OWNED_YOUTUBE_HANDLES = new Set(['@stkittsnevislabourparty', '@sknismedia']);

function isOwnedYoutubeHandle(urlOrHandle: string): boolean {
  const match = urlOrHandle.match(/@[\w.-]+/);
  return match ? OWNED_YOUTUBE_HANDLES.has(match[0].toLowerCase()) : false;
}

export interface ResolvedSourceDefaults {
  platform: string;
  detection_method: string;
  tier: string;
  requires_manual_capture: boolean;
}

// The one place Type -> {platform, detection_method, tier, requires_manual_capture}
// is decided. detection_method stays 'public_rss' even for an owned YouTube
// match (not 'push_webhook' like the real owned rows in the seed data) —
// this form has no OAuth/webhook setup flow behind it, so it can't honestly
// claim push_webhook just because the channel is ours; that upgrade is a
// deliberate follow-up action, not something a label match should silently imply.
export function resolveSourceDefaults(type: string, urlOrHandle: string): ResolvedSourceDefaults {
  switch (type) {
    case 'youtube_channel':
      return {
        platform: 'youtube',
        detection_method: 'public_rss',
        tier: isOwnedYoutubeHandle(urlOrHandle) ? 'owned' : 'third_party',
        requires_manual_capture: false
      };
    case 'website':
      return { platform: 'website', detection_method: 'public_rss', tier: 'third_party', requires_manual_capture: false };
    case 'single_video':
    case 'image_upload':
    case 'paste_text':
    case 'other':
      return { platform: 'other', detection_method: 'manual_capture', tier: 'third_party', requires_manual_capture: true };
    default:
      throw new Error(`Unknown add-source type: ${type}`);
  }
}
