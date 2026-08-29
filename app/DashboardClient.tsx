'use client';

import { useMemo, useState } from 'react';
import styles from './dashboard.module.css';
import type { DashboardClaim } from './lib/claims';

const ALL = 'all';

export default function DashboardClient({ claims }: { claims: DashboardClaim[] }) {
  const years = useMemo(
    () => Array.from(new Set(claims.map((c) => c.year).filter((y): y is number => y != null))).sort((a, b) => b - a),
    [claims]
  );
  const categories = useMemo(
    () =>
      Array.from(new Set(claims.map((c) => c.category).filter((c): c is string => !!c))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [claims]
  );

  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);

  const filtered = claims.filter(
    (c) =>
      (yearFilter === ALL || String(c.year) === yearFilter) &&
      (categoryFilter === ALL || c.category === categoryFilter)
  );

  return (
    <>
      <div className={styles.filterRow}>
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
        <div className={styles.filterSep} />
        <span
          className={`${styles.pill} ${categoryFilter === ALL ? styles.pillActive : ''}`}
          onClick={() => setCategoryFilter(ALL)}
        >
          All sectors
        </span>
        {categories.map((cat) => (
          <span
            key={cat}
            className={`${styles.pill} ${categoryFilter === cat ? styles.pillActive : ''}`}
            onClick={() => setCategoryFilter(cat)}
          >
            {cat}
          </span>
        ))}
      </div>

      <div className={styles.claimGrid}>
        {filtered.length === 0 && (
          <div className={styles.emptyState}>No accomplishments match these filters yet.</div>
        )}
        {filtered.map((c) => (
          <div className={styles.claimCard} key={c.id}>
            <div className={styles.pin}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className={styles.cat}>{c.category ?? 'Uncategorized'}</span>
            <h3>{c.title}</h3>
            <div className={styles.summary}>{c.summary}</div>
            <div className={styles.meta}>
              <span className={styles.src}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                {c.source_org}
              </span>
              <span className={styles.date}>{c.event_date ?? 'date unknown'}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
