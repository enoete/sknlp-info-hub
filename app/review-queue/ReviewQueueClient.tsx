'use client';

import { useMemo, useState } from 'react';
import styles from './review-queue.module.css';
import type { ReviewQueueClaim } from '@/app/lib/reviewQueue';

type Decision =
  | { kind: 'approved'; citizenImpactCopied: boolean; eventDateCopied: boolean }
  | { kind: 'rejected' }
  | { kind: 'unapproved' }
  | { kind: 'error'; message: string };

type StatusFilter = 'all' | 'pending_review' | 'approved' | 'rejected';
const ALL_CHANNELS = 'all';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending_review', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

// Where a source actually entered our system — youtube/sknis/press_release/
// social_post/admin_upload/manual_entry (schema.sql's ingestion_channel
// enum). Distinct from source_type (official/opposition/press, already
// shown via the stance tag) and from sources_registry.platform (not
// always present — plenty of claims have no registry row behind them).
const CHANNEL_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  sknis: 'SKNIS',
  press_release: 'Press Release',
  social_post: 'Social Post',
  admin_upload: 'Admin Upload',
  manual_entry: 'Manual Entry'
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export default function ReviewQueueClient({ claims: initialClaims }: { claims: ReviewQueueClaim[] }) {
  const [claims, setClaims] = useState(initialClaims);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [channelFilter, setChannelFilter] = useState<string>(ALL_CHANNELS);
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Only ever shows channels actually present in the data (same rule as
  // Dashboard's category pills / Opposition Watch's sector pills) — never
  // a static list of every enum value regardless of whether anything uses it.
  const channels = useMemo(
    () => Array.from(new Set(claims.map((c) => c.channel))).sort((a, b) => channelLabel(a).localeCompare(channelLabel(b))),
    [claims]
  );

  const counts = {
    all: claims.length,
    pending_review: claims.filter((c) => c.review_status === 'pending_review').length,
    approved: claims.filter((c) => c.review_status === 'approved').length,
    rejected: claims.filter((c) => c.review_status === 'rejected').length
  };
  const channelCounts: Record<string, number> = {};
  for (const c of claims) channelCounts[c.channel] = (channelCounts[c.channel] ?? 0) + 1;

  const filtered = claims.filter(
    (c) =>
      (statusFilter === 'all' || c.review_status === statusFilter) &&
      (channelFilter === ALL_CHANNELS || c.channel === channelFilter)
  );

  async function decide(id: string, action: 'approve' | 'reject' | 'unapprove') {
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
      } else {
        if (action === 'approve') {
          setDecided((d) => ({
            ...d,
            [id]: { kind: 'approved', citizenImpactCopied: data.citizen_impact_copied, eventDateCopied: data.event_date_copied }
          }));
        } else if (action === 'reject') {
          setDecided((d) => ({ ...d, [id]: { kind: 'rejected' } }));
        } else {
          setDecided((d) => ({ ...d, [id]: { kind: 'unapproved' } }));
        }
        // Update local state to match the new real review_status (and
        // clear the published fields on unapprove) so the card's own
        // status tag / content stays honest without a full page reload —
        // deliberately no router.refresh() here for the same reason as
        // the original approve/reject flow: an immediate re-fetch would
        // yank this card out of a status-filtered view before the
        // confirmation message is even visible.
        setClaims((cs) =>
          cs.map((c) =>
            c.id === id
              ? {
                  ...c,
                  review_status: data.review_status,
                  citizen_impact: action === 'unapprove' ? null : c.citizen_impact,
                  event_date: action === 'unapprove' ? null : c.event_date
                }
              : c
          )
        );
      }
    } catch (err) {
      setDecided((d) => ({ ...d, [id]: { kind: 'error', message: String(err) } }));
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <>
      <div className={styles.filterRow}>
        {STATUS_TABS.map((tab) => (
          <span
            key={tab.value}
            className={`${styles.pill} ${statusFilter === tab.value ? styles.pillActive : ''}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label} ({counts[tab.value]})
          </span>
        ))}
      </div>
      <div className={styles.filterRow}>
        <span
          className={`${styles.pill} ${channelFilter === ALL_CHANNELS ? styles.pillActive : ''}`}
          onClick={() => setChannelFilter(ALL_CHANNELS)}
        >
          All sources ({claims.length})
        </span>
        {channels.map((ch) => (
          <span
            key={ch}
            className={`${styles.pill} ${channelFilter === ch ? styles.pillActive : ''}`}
            onClick={() => setChannelFilter(ch)}
          >
            {channelLabel(ch)} ({channelCounts[ch]})
          </span>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No claims match this filter.</div>
      ) : (
        filtered.map((c) => {
          const decision = decided[c.id];
          const isPending = !!pending[c.id];

          return (
            <div className={styles.card} key={c.id}>
              <div className={styles.metaRow}>
                <span className={`${styles.tag} ${c.stance === 'opposition_statement' ? styles.tagOpposition : styles.tagAccomplishment}`}>
                  {c.stance === 'opposition_statement' ? 'Opposition' : 'Accomplishment'}
                </span>
                <span className={styles.tag} style={{ background: 'var(--paper-2)', color: 'var(--muted)' }}>
                  {c.category ?? 'Uncategorized'}
                </span>
                <span className={styles.tag} style={{ background: 'var(--gold-tint)', color: 'var(--gold-ink)' }}>
                  {channelLabel(c.channel)}
                </span>
                <span
                  className={`${styles.tag} ${
                    c.review_status === 'approved'
                      ? styles.tagAccomplishment
                      : c.review_status === 'rejected'
                        ? styles.tagOpposition
                        : styles.tagPending
                  }`}
                >
                  {c.review_status === 'pending_review' ? 'Pending review' : c.review_status}
                </span>
              </div>

              <h3 className={styles.title}>{c.title}</h3>
              <p className={styles.summary}>{c.summary}</p>

              <div className={styles.srcLine}>
                {c.source_type} — {c.speaker_org} — {c.source_title} &middot;{' '}
                <a href={c.origin_url} target="_blank" rel="noreferrer">
                  view source
                </a>
              </div>

              {c.review_status === 'approved' ? (
                <div className={styles.suggestBlock}>
                  <div className={styles.suggestLabel}>Published</div>
                  {c.citizen_impact ? (
                    <div className={styles.suggestField}>
                      <b>citizen_impact:</b> {c.citizen_impact}
                    </div>
                  ) : (
                    <div className={styles.suggestEmpty}>No citizen_impact set.</div>
                  )}
                  {c.event_date ? (
                    <div className={styles.suggestField}>
                      <b>event_date:</b> {c.event_date}
                    </div>
                  ) : (
                    <div className={styles.suggestEmpty}>No event_date set.</div>
                  )}
                  <div className={styles.suggestNote}>
                    Live on the public site right now. Unapproving clears both of these — it&apos;s a full
                    retraction, not a soft toggle.
                  </div>
                </div>
              ) : (
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
              )}

              {!decision && c.review_status === 'pending_review' && (
                <div className={styles.actions}>
                  <button className={`${styles.btn} ${styles.btnApprove}`} disabled={isPending} onClick={() => decide(c.id, 'approve')}>
                    {isPending ? 'Working…' : 'Approve'}
                  </button>
                  <button className={`${styles.btn} ${styles.btnReject}`} disabled={isPending} onClick={() => decide(c.id, 'reject')}>
                    {isPending ? 'Working…' : 'Reject'}
                  </button>
                </div>
              )}
              {!decision && c.review_status === 'approved' && (
                <div className={styles.actions}>
                  <button className={`${styles.btn} ${styles.btnReject}`} disabled={isPending} onClick={() => decide(c.id, 'unapprove')}>
                    {isPending ? 'Working…' : 'Unapprove'}
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
              {decision?.kind === 'unapproved' && (
                <div className={`${styles.decisionNote} ${styles.decisionRejected}`}>
                  Unapproved — back to &apos;pending_review&apos;. citizen_impact and event_date were cleared.
                  Gone from the Dashboard, Ask the Record, and Opposition Watch immediately.
                </div>
              )}
              {decision?.kind === 'error' && <div className={`${styles.decisionNote} ${styles.decisionError}`}>Error: {decision.message}</div>}
            </div>
          );
        })
      )}
    </>
  );
}
