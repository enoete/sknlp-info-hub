import styles from './source-manager.module.css';
import { getRegisteredSources, RegisteredSource } from '@/app/lib/sourceManager';
import { relativeTime } from '@/app/lib/time';
import AddSourceForm from './AddSourceForm';

export const dynamic = 'force-dynamic';

const PLATFORM_ICON: Record<string, string> = {
  youtube: 'YT',
  facebook: 'FB',
  instagram: 'IG',
  sknis: 'SK',
  website: 'W',
  radio: 'R',
  other: '?'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  needs_legal_review: 'Needs legal review'
};

const STATUS_DOT_CLASS: Record<string, string> = {
  active: styles.statusActive,
  paused: styles.statusPaused,
  needs_legal_review: styles.statusNeedsReview
};

function sourceMetaLine(s: RegisteredSource): string {
  const parts = [STATUS_LABEL[s.status] ?? s.status];
  if (s.requires_manual_capture) {
    parts.push('manual capture only');
  } else {
    parts.push(s.tier === 'owned' ? 'owned' : 'third-party');
    parts.push(`last checked ${relativeTime(s.last_checked_at)}`);
    parts.push(`last new item ${relativeTime(s.last_new_item_at)}`);
  }
  return parts.join(' · ');
}

export default async function SourceManagerPage() {
  const sources = await getRegisteredSources();
  const existingLabels = Array.from(new Set(sources.map((s) => s.label)));

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Internal · admin only</div>
        <h1>SOURCE MANAGER</h1>
        <p>
          Every channel, site, or feed the ingestion agent watches, plus one-off items added by
          hand. Config only — this doesn&apos;t show extracted content itself.
        </p>
      </div>

      <div className={styles.stageNote}>
        Stage 2: add a source (writes to <code>sources_registry</code> only). Edit/delete aren&apos;t
        wired up yet. YouTube channel discovery is real (
        <code>ingestion/run_channel_discovery.py --registry-id &lt;id&gt;</code>, resolves the channel,
        checks its recent uploads, extracts and writes new claims as <code>pending_review</code>) but
        runs from the command line only — no web &quot;Run&quot; button yet, since the Python ingestion
        environment isn&apos;t part of this app&apos;s Docker image. See{' '}
        <code>design-reference/source-manager-mockup.html</code> for the full planned view.
      </div>

      <AddSourceForm existingLabels={existingLabels} />

      <h2 className={styles.sectionLabel}>Registered sources ({sources.length})</h2>

      {sources.length === 0 ? (
        <div className={styles.emptyState}>
          No sources registered yet. <code>sources_registry</code> is config for the ingestion
          agent (see CLAUDE.md) and hasn&apos;t been seeded — this list will populate once known
          sources are added.
        </div>
      ) : (
        sources.map((s) => (
          <div className={styles.sourceRow} key={s.id}>
            <div className={styles.sourceIcon}>{PLATFORM_ICON[s.platform] ?? '?'}</div>
            <div className={styles.sourceMain}>
              <div className={styles.name}>{s.label}</div>
              <div className={styles.meta}>
                <span className={`${styles.statusDot} ${STATUS_DOT_CLASS[s.status] ?? ''}`} />
                {sourceMetaLine(s)}
              </div>
            </div>
            <div className={styles.tierBadge}>{s.source_type.replace('_', ' ')}</div>
          </div>
        ))
      )}
    </main>
  );
}
