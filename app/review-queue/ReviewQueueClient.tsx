'use client';

import { useState } from 'react';
import styles from './review-queue.module.css';
import type { PendingClaim } from '@/app/lib/reviewQueue';

type Decision =
  | { kind: 'approved'; citizenImpactCopied: boolean; eventDateCopied: boolean }
  | { kind: 'rejected' }
  | { kind: 'error'; message: string };

export default function ReviewQueueClient({ claims }: { claims: PendingClaim[] }) {
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function decide(id: string, action: 'approve' | 'reject') {
    setPending((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/review-queue/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) {
        setDecided((d) => ({ ...d, [id]: { kind: 'error', message: data.error || `Request failed (${res.status})` } }));
      } else if (action === 'approve') {
        setDecided((d) => ({
          ...d,
          [id]: { kind: 'approved', citizenImpactCopied: data.citizen_impact_copied, eventDateCopied: data.event_date_copied }
        }));
      } else {
        setDecided((d) => ({ ...d, [id]: { kind: 'rejected' } }));
      }
      // Deliberately no router.refresh() here: that would re-fetch the
      // pending-only server query, which would immediately drop this card
      // (and its decision note) out of the list — exactly the "hidden, not
      // visible" outcome the copy-step confirmation is supposed to avoid.
      // The card stays showing its decision until the page is next loaded
      // fresh, by which point the DB write is already long done.
    } catch (err) {
      setDecided((d) => ({ ...d, [id]: { kind: 'error', message: String(err) } }));
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  if (claims.length === 0) {
    return <div className={styles.emptyState}>No claims are currently pending review.</div>;
  }

  return (
    <>
      {claims.map((c) => {
        const decision = decided[c.id];
        const isPending = !!pending[c.id];
        const alreadyDecided = decision && decision.kind !== 'error';

        return (
          <div className={styles.card} key={c.id}>
            <div className={styles.metaRow}>
              <span className={`${styles.tag} ${c.stance === 'opposition_statement' ? styles.tagOpposition : styles.tagAccomplishment}`}>
                {c.stance === 'opposition_statement' ? 'Opposition' : 'Accomplishment'}
              </span>
              <span className={styles.tag} style={{ background: 'var(--paper-2)', color: 'var(--muted)' }}>
                {c.category ?? 'Uncategorized'}
              </span>
              <span className={`${styles.tag} ${styles.tagPending}`}>Pending review</span>
            </div>

            <h3 className={styles.title}>{c.title}</h3>
            <p className={styles.summary}>{c.summary}</p>

            <div className={styles.srcLine}>
              {c.source_type} — {c.speaker_org} — {c.source_title} &middot;{' '}
              <a href={c.origin_url} target="_blank" rel="noreferrer">
                view source
              </a>
            </div>

            <div className={styles.suggestBlock}>
              <div className={styles.suggestLabel}>Draft suggestions — not yet published</div>
              {c.citizen_impact_suggested ? (
                <div className={styles.suggestField}>
                  <b>citizen_impact_suggested:</b> {c.citizen_impact_suggested}
                </div>
              ) : (
                <div className={styles.suggestEmpty}>No citizen_impact_suggested.</div>
              )}
              {c.event_date_suggested ? (
                <div className={styles.suggestField}>
                  <b>event_date_suggested:</b> {c.event_date_suggested}
                </div>
              ) : (
                <div className={styles.suggestEmpty}>No event_date_suggested.</div>
              )}
              <div className={styles.suggestNote}>
                Approving copies whichever of these exist into the real citizen_impact / event_date
                fields — this is the only way those fields ever get set from a draft.
              </div>
            </div>

            {!alreadyDecided && (
              <div className={styles.actions}>
                <button className={`${styles.btn} ${styles.btnApprove}`} disabled={isPending} onClick={() => decide(c.id, 'approve')}>
                  {isPending ? 'Working…' : 'Approve'}
                </button>
                <button className={`${styles.btn} ${styles.btnReject}`} disabled={isPending} onClick={() => decide(c.id, 'reject')}>
                  {isPending ? 'Working…' : 'Reject'}
                </button>
              </div>
            )}

            {decision?.kind === 'approved' && (
              <div className={`${styles.decisionNote} ${styles.decisionApproved}`}>
                Approved — review_status is now &apos;approved&apos;.{' '}
                {decision.citizenImpactCopied ? 'citizen_impact_suggested was copied into citizen_impact.' : 'No citizen_impact_suggested existed, so citizen_impact was left unset.'}{' '}
                {decision.eventDateCopied ? 'event_date_suggested was copied into event_date.' : 'No event_date_suggested existed, so event_date was left unset.'}
              </div>
            )}
            {decision?.kind === 'rejected' && (
              <div className={`${styles.decisionNote} ${styles.decisionRejected}`}>Rejected — review_status is now &apos;rejected&apos;.</div>
            )}
            {decision?.kind === 'error' && <div className={`${styles.decisionNote} ${styles.decisionError}`}>Error: {decision.message}</div>}
          </div>
        );
      })}
    </>
  );
}
