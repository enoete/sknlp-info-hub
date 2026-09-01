'use client';

import { useMemo, useState } from 'react';
import styles from './dashboard.module.css';
import type { DashboardClaim } from './lib/claims';
import { getCategoryColor } from './lib/categoryColors';
import { accomplishmentTypeLabel } from './lib/accomplishmentType';

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

      <div className={styles.claimGrid}>
        {filtered.length === 0 && (
          <div className={styles.emptyState}>No accomplishments match these filters yet.</div>
        )}
        {filtered.map((c) => {
          const color = getCategoryColor(c.category);
          return (
          <div className={styles.claimCard} key={c.id}>
            <div className={styles.pin}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className={styles.tagRow}>
              <span className={styles.cat} style={{ background: color.tint, color: color.ink }}>
                {c.category ?? 'Uncategorized'}
              </span>
              <span className={styles.typeTag}>{accomplishmentTypeLabel(c.accomplishment_type)}</span>
            </div>
            <h3>{c.title}</h3>
            {c.completed_by_claim_id && (
              <a href={`/claim/${c.completed_by_claim_id}`} className={styles.completedBanner}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 13l4 4L19 7" />
                </svg>
                Since completed{c.completed_by_date ? ` — ${c.completed_by_date}` : ''}: {c.completed_by_title}
              </a>
            )}
            <div className={styles.summary}>{c.summary}</div>
            {c.citizen_impact && (
              <div className={styles.impactBlock}>
                <div className={styles.impactLabel}>What this means for you</div>
                <p>{c.citizen_impact}</p>
              </div>
            )}
            <div className={styles.meta}>
              <div className={styles.metaLeft}>
                <a className={styles.src} href={c.source_url} target="_blank" rel="noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  {c.source_org}
                </a>
                {c.source_count > 1 && (
                  <span className={styles.corroborated} title="Multiple independent sources reported this same fact">
                    &middot; documented with {c.source_count} independent sources
                  </span>
                )}
              </div>
              <span className={styles.date}>{c.event_date ?? 'date unknown'}</span>
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}
