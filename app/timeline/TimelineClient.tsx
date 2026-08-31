'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './timeline.module.css';
import type { TimelineClaim } from '@/app/lib/claims';
import { getCategoryColor } from '@/app/lib/categoryColors';
import { accomplishmentTypeLabel } from '@/app/lib/accomplishmentType';

const ALL = 'all';
const UNDATED_KEY = 'undated';

export default function TimelineClient({ claims }: { claims: TimelineClaim[] }) {
  const [stanceFilter, setStanceFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);

  const categories = useMemo(
    () =>
      Array.from(new Set(claims.map((c) => c.category).filter((c): c is string => !!c))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [claims]
  );

  const filtered = claims.filter(
    (c) =>
      (stanceFilter === ALL || c.stance === stanceFilter) &&
      (categoryFilter === ALL || c.category === categoryFilter)
  );

  // Group by year extracted from event_date, most recent year first
  // (matches the rest of the app's "what's most current" framing).
  // Anything with no event_date goes into its own explicit bucket at the
  // end rather than being silently dropped — see getTimelineClaims'
  // comment for why that gap has to stay visible.
  const groups = useMemo(() => {
    const byYear = new Map<string, TimelineClaim[]>();
    for (const c of filtered) {
      const key = c.event_date ? c.event_date.slice(0, 4) : UNDATED_KEY;
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key)!.push(c);
    }
    const years = Array.from(byYear.keys())
      .filter((k) => k !== UNDATED_KEY)
      .sort((a, b) => Number(b) - Number(a));
    return { years, byYear, undated: byYear.get(UNDATED_KEY) ?? [] };
  }, [filtered]);

  return (
    <>
      <div className={styles.filterRow}>
        <span className={`${styles.pill} ${stanceFilter === ALL ? styles.pillActive : ''}`} onClick={() => setStanceFilter(ALL)}>
          Everything
        </span>
        <span
          className={`${styles.pill} ${stanceFilter === 'accomplishment' ? styles.pillActive : ''}`}
          onClick={() => setStanceFilter('accomplishment')}
        >
          Accomplishments
        </span>
        <span
          className={`${styles.pill} ${stanceFilter === 'opposition_statement' ? styles.pillActive : ''}`}
          onClick={() => setStanceFilter('opposition_statement')}
        >
          Opposition statements
        </span>
        <div className={styles.filterSep} />
        <span className={`${styles.pill} ${categoryFilter === ALL ? styles.pillActive : ''}`} onClick={() => setCategoryFilter(ALL)}>
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
        <div className={styles.emptyState}>No claims match these filters yet.</div>
      ) : (
        <div className={styles.rail}>
          {groups.years.map((year) => {
            const items = groups.byYear.get(year)!;
            return (
              <div className={styles.yearBlock} key={year}>
                <div className={styles.yearMarker} />
                <h2 className={styles.yearHeading}>
                  {year}
                  <span className={styles.yearCount}>
                    {items.length} entr{items.length === 1 ? 'y' : 'ies'}
                  </span>
                </h2>
                <div className={styles.items}>
                  {items.map((c) => (
                    <TimelineItem key={c.id} claim={c} />
                  ))}
                </div>
              </div>
            );
          })}

          {groups.undated.length > 0 && (
            <div className={styles.undatedSection}>
              <h3 className={styles.undatedHead}>Date not yet confirmed ({groups.undated.length})</h3>
              <p className={styles.undatedNote}>
                These are real, approved claims — they just don&apos;t have a confirmed event date yet. They&apos;ll
                move into their proper place on this timeline once someone confirms a date via the Review Queue.
              </p>
              <div className={styles.items}>
                {groups.undated.map((c) => (
                  <TimelineItem key={c.id} claim={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TimelineItem({ claim }: { claim: TimelineClaim }) {
  const color = getCategoryColor(claim.category);
  const isOpposition = claim.stance === 'opposition_statement';
  return (
    <Link
      href={`/claim/${claim.id}`}
      className={styles.item}
      style={{ borderLeftColor: isOpposition ? 'var(--red)' : color.ink }}
    >
      <span className={styles.itemDot} style={{ borderColor: isOpposition ? 'var(--red)' : color.ink }} />
      <div className={styles.itemMeta}>
        <span className={`${styles.stanceTag} ${isOpposition ? styles.stanceOpposition : styles.stanceAccomplishment}`}>
          {isOpposition ? 'Opposition' : accomplishmentTypeLabel(claim.accomplishment_type)}
        </span>
        <span className={styles.catTag} style={{ background: color.tint, color: color.ink }}>
          {claim.category ?? 'Uncategorized'}
        </span>
        {claim.event_date && <span className={styles.dateTag}>{claim.event_date}</span>}
      </div>
      <h3 className={styles.itemTitle}>{claim.title}</h3>
      <p className={styles.itemSummary}>{claim.summary}</p>
      {claim.citizen_impact && <div className={styles.itemImpact}>{claim.citizen_impact}</div>}
    </Link>
  );
}
