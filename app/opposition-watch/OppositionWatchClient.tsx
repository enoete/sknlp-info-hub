'use client';

import { useMemo, useState } from 'react';
import styles from './opposition-watch.module.css';
import type { OppositionPair } from '@/app/lib/oppositionWatch';
import { getCategoryColor } from '@/app/lib/categoryColors';

const ALL = 'all';

export default function OppositionWatchClient({ pairs }: { pairs: OppositionPair[] }) {
  const categories = useMemo(
    () => Array.from(new Set(pairs.map((p) => p.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)),
    [pairs]
  );
  // "Who said it" — the actual named individual (Timothy Harris, Mark
  // Brantley, Kyle Flanders, Ian "Patches" Liburd, ...) when it's been
  // identified, per claim (transcript_segments.speaker_name_at_time —
  // see oppositionWatch.ts). Falls back to the channel/source name only
  // for the claims that genuinely have no resolved individual yet, so
  // nothing silently disappears from the filter list while it's still
  // being backfilled — those just show up bucketed by source instead of
  // by name until a real speaker is identified.
  const speakerOf = (p: OppositionPair) => p.named_speaker ?? p.speaker_org;
  const speakers = useMemo(
    () => Array.from(new Set(pairs.map(speakerOf).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [pairs]
  );
  const years = useMemo(
    () => Array.from(new Set(pairs.map((p) => p.year).filter((y): y is number => y != null))).sort((a, b) => b - a),
    [pairs]
  );

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [speakerFilter, setSpeakerFilter] = useState<string>(ALL);
  const [yearFilter, setYearFilter] = useState<string>(ALL);

  const filtered = pairs.filter((p) => {
    const status = p.record ? 'documented' : 'undocumented';
    return (
      (statusFilter === ALL || status === statusFilter) &&
      (categoryFilter === ALL || p.category === categoryFilter) &&
      (speakerFilter === ALL || speakerOf(p) === speakerFilter) &&
      (yearFilter === ALL || String(p.year) === yearFilter)
    );
  });

  return (
    <>
      <div className={styles.filterRow}>
        <span
          className={`${styles.pill} ${statusFilter === ALL ? styles.pillActive : ''}`}
          onClick={() => setStatusFilter(ALL)}
        >
          All statuses
        </span>
        <span
          className={`${styles.pill} ${statusFilter === 'undocumented' ? styles.pillActive : ''}`}
          onClick={() => setStatusFilter('undocumented')}
        >
          No clarification yet
        </span>
        <span
          className={`${styles.pill} ${statusFilter === 'documented' ? styles.pillActive : ''}`}
          onClick={() => setStatusFilter('documented')}
        >
          Clarified
        </span>
        <div className={styles.filterSep} />
        <span
          className={`${styles.pill} ${categoryFilter === ALL ? styles.pillActive : ''}`}
          onClick={() => setCategoryFilter(ALL)}
        >
          All sectors
        </span>
        {categories.map((cat) => {
          const active = categoryFilter === cat;
          const color = getCategoryColor(cat);
          return (
            <span
              key={cat}
              className={`${styles.pill} ${active ? styles.pillActive : ''}`}
              style={active ? undefined : { background: color.tint, color: color.ink, borderColor: 'transparent' }}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat}
            </span>
          );
        })}
        <div className={styles.filterSep} />
        <span
          className={`${styles.pill} ${speakerFilter === ALL ? styles.pillActive : ''}`}
          onClick={() => setSpeakerFilter(ALL)}
        >
          All speakers
        </span>
        {speakers.map((sp) => (
          <span
            key={sp}
            className={`${styles.pill} ${speakerFilter === sp ? styles.pillActive : ''}`}
            onClick={() => setSpeakerFilter(sp)}
          >
            {sp}
          </span>
        ))}
        <div className={styles.filterSep} />
        <span
          className={`${styles.pill} ${yearFilter === ALL ? styles.pillActive : ''}`}
          onClick={() => setYearFilter(ALL)}
        >
          All years
        </span>
        {years.map((y) => (
          <span
            key={y}
            className={`${styles.pill} ${yearFilter === String(y) ? styles.pillActive : ''}`}
            onClick={() => setYearFilter(String(y))}
          >
            {y}
          </span>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No opposition statements match these filters yet.</div>
      ) : (
        filtered.map((p) => {
          const color = getCategoryColor(p.category);
          const documented = !!p.record;
          const manual = p.record_source === 'manual';
          return (
            <div className={styles.oppoPair} key={p.id}>
              <div className={styles.oppoHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={styles.catTag} style={{ background: color.tint, color: color.ink }}>
                    {p.category ?? 'Uncategorized'}
                  </span>
                  <span
                    className={`${styles.statusChip} ${manual ? styles.statusManual : documented ? styles.statusDocumented : styles.statusUndocumented}`}
                  >
                    {manual ? 'Clarified by admin' : documented ? 'Clarified' : 'No clarification yet'}
                  </span>
                </div>
              </div>

              <div className={`${styles.oppoHalf} ${styles.oppoHalfClaim}`}>
                <div className={styles.oppoTag}>Opposition statement</div>
                <p>&quot;{p.summary}&quot;</p>
                <div className={styles.metaLine}>
                  {p.named_speaker ? `${p.named_speaker} — ` : ''}
                  {p.speaker_org} &middot; <span className={styles.mono}>{p.published_at ?? p.event_date ?? 'date unknown'}</span> &middot;{' '}
                  <a href={p.origin_url} target="_blank" rel="noreferrer">
                    view source
                  </a>
                </div>
              </div>

              {p.record ? (
                <div className={`${styles.oppoHalf} ${styles.oppoHalfRecord}`}>
                  <div className={styles.oppoTag}>{manual ? 'Clarification (confirmed by admin)' : 'Clarification'}</div>
                  <p>{p.record.summary}</p>
                  <div className={styles.metaLine}>
                    {p.record.speaker_org} — {p.record.source_title} &middot;{' '}
                    <span className={styles.mono}>{p.record.published_at ?? 'date unknown'}</span> &middot;{' '}
                    <a href={p.record.origin_url} target="_blank" rel="noreferrer">
                      view source
                    </a>
                  </div>
                </div>
              ) : (
                <div className={`${styles.oppoHalf} ${styles.oppoHalfNone}`}>
                  <div className={styles.oppoTag}>No clarification yet</div>
                  <p>This isn&apos;t a denial — it just means nothing on record addresses this specific claim yet.</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
