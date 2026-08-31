import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from './claim-detail.module.css';
import { getClaimById } from '@/app/lib/claims';
import { sourceLinkLabel } from '@/app/lib/youtube';
import { getCategoryColor } from '@/app/lib/categoryColors';

export const dynamic = 'force-dynamic';

export default async function ClaimDetailPage({ params }: { params: { id: string } }) {
  const claim = await getClaimById(params.id);
  if (!claim) notFound();

  const isOpposition = claim.stance === 'opposition_statement';
  const color = getCategoryColor(claim.category);

  return (
    <main className="max-w-4xl mx-auto px-9 py-12">
      <Link href="/timeline" className={styles.backLink}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to Timeline
      </Link>

      <div className={styles.head}>
        <div>
          <div className={styles.headMeta}>
            <span className={`${styles.tag} ${isOpposition ? styles.tagOpposition : styles.tagAccomplishment}`}>
              {isOpposition ? 'Opposition statement' : 'Accomplishment'}
            </span>
            <span className={styles.tag} style={{ background: color.tint, color: color.ink }}>
              {claim.category ?? 'Uncategorized'}
            </span>
          </div>
          <h1>{claim.title}</h1>
          <div className={`${styles.verifyLine} ${isOpposition ? styles.verifyLineOpposition : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isOpposition ? (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </>
              ) : (
                <path d="M5 13l4 4L19 7" />
              )}
            </svg>
            {isOpposition
              ? 'A public statement, documented and paired with the closest matching record below'
              : `Documented with ${claim.source_count} independent source${claim.source_count === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className={`${styles.pin} ${isOpposition ? styles.pinOpposition : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isOpposition ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </>
            ) : (
              <path d="M5 13l4 4L19 7" />
            )}
          </svg>
        </div>
      </div>

      <div className={styles.grid}>
        <div>
          {claim.citizen_impact && (
            <div className={styles.impactBlock}>
              <div className={styles.impactLabel}>What this means for you</div>
              <p>{claim.citizen_impact}</p>
            </div>
          )}

          <div className={styles.block}>
            <h4>Source</h4>
            <div className={styles.citation}>
              <div className={styles.citationIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </div>
              <div>
                <div className={styles.srcTitle}>{claim.source_title}</div>
                <div className={styles.srcMeta}>
                  {claim.source_type} — {claim.speaker_name ? `${claim.speaker_name}, ` : ''}
                  {claim.speaker_org}
                  {claim.published_at ? ` · ${claim.published_at}` : ''}
                </div>
                <a className={styles.tsLink} href={claim.source_url} target="_blank" rel="noreferrer">
                  {sourceLinkLabel(claim.source_url)}
                </a>
              </div>
            </div>
          </div>

          {isOpposition && (
            <div className={styles.block}>
              <h4>Closest documented record</h4>
              {claim.closest_record ? (
                <div className={styles.compareBox}>
                  <span className={styles.compareTag}>Official record</span>
                  <p>{claim.closest_record.title}</p>
                  <a
                    className={styles.compareLink}
                    href={claim.closest_record.origin_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {claim.closest_record.source_type} — {claim.closest_record.speaker_org}
                    {claim.closest_record.published_at ? ` · ${claim.closest_record.published_at}` : ''}
                  </a>
                </div>
              ) : (
                <div className={`${styles.compareBox} ${styles.compareBoxNone}`}>
                  <span className={styles.compareTag}>No record found</span>
                  <p>
                    No official record found in this category yet. This isn&apos;t a denial — it just means no
                    matching documented accomplishment is on file.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className={styles.block}>
            <h4>Party-supplied proof</h4>
            {claim.proof_documents.length > 0 ? (
              claim.proof_documents.map((p) => (
                <div className={styles.proofRow} key={p.id}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  <div>
                    <div className={styles.proofName}>{p.title}</div>
                    <div className={styles.proofMeta}>
                      {p.file_type}
                      {p.document_dated_at ? ` · ${p.document_dated_at}` : ''}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyNote}>No supporting documents uploaded yet.</div>
            )}
          </div>

          <div className={styles.block}>
            <h4>Record status</h4>
            <div className={styles.statusLine}>
              Event date on file: <b>{claim.event_date ?? 'not yet confirmed'}</b>
              <br />
              Category: <b>{claim.category ?? 'Uncategorized'}</b>
              <br />
              Review status: <b style={{ color: 'var(--green-ink)' }}>Approved</b>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
