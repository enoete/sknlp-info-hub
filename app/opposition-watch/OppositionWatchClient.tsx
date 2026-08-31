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

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);

  const filtered = pairs.filter((p) => {
    const status = p.record ? 'documented' : 'undocumented';
    return (
      (statusFilter === ALL || status === statusFilter) &&
      (categoryFilter === ALL || p.category === categoryFilter)
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
          No record yet
        </span>
        <span
          className={`${styles.pill} ${statusFilter === 'documented' ? styles.pillActive : ''}`}
          onClick={() => setStatusFilter('documented')}
        >
          Documented
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
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No opposition statements match these filters yet.</div>
      ) : (
        filtered.map((p) => {
          const color = getCategoryColor(p.category);
          const documented = !!p.record;
          return (
            <div className={styles.oppoPair} key={p.id}>
              <div className={styles.oppoHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={styles.catTag} style={{ background: color.tint, color: color.ink }}>
                    {p.category ?? 'Uncategorized'}
                  </span>
                  <span className={`${styles.statusChip} ${documented ? styles.statusDocumented : styles.statusUndocumented}`}>
                    {documented ? 'Documented' : 'No record yet'}
                  </span>
                </div>
              </div>

              <div className={`${styles.oppoHalf} ${styles.oppoHalfClaim}`}>
                <div className={styles.oppoTag}>Opposition statement</div>
                <p>&quot;{p.summary}&quot;</p>
                <div className={styles.metaLine}>
                  {p.speaker_name ? `${p.speaker_name} — ` : ''}
                  {p.speaker_org} &middot; <span className={styles.mono}>{p.published_at ?? p.event_date ?? 'date unknown'}</span> &middot;{' '}
                  <a href={p.origin_url} target="_blank" rel="noreferrer">
                    view source
                  </a>
                </div>
              </div>

              {p.record ? (
                <div className={`${styles.oppoHalf} ${styles.oppoHalfRecord}`}>
                  <div className={styles.oppoTag}>Closest documented record</div>
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
                  <div className={styles.oppoTag}>No official record found</div>
                  <p>This isn&apos;t a denial — it just means nothing documented addresses this specific claim yet.</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
