'use client';

import { useMemo, useState } from 'react';
import styles from './review-queue.module.css';
import type { ReviewQueueClaim, ClaimSearchResult } from '@/app/lib/reviewQueue';
import { accomplishmentTypeLabel, ACCOMPLISHMENT_TYPES } from '@/app/lib/accomplishmentType';

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

  // Source-URL editing — keyed by source_id (not claim id), since several
  // claims can share one source row and editing it updates all of them at
  // once (see ReviewQueueClaim.source_claim_count).
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEditingSource(c: ReviewQueueClaim) {
    setEditingSourceId(c.source_id);
    setEditValue(c.origin_url);
    setEditError(null);
  }

  function cancelEditingSource() {
    setEditingSourceId(null);
    setEditValue('');
    setEditError(null);
  }

  async function saveSourceUrl(sourceId: string) {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin_url: editValue })
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || `Request failed (${res.status})`);
        return;
      }
      // Every claim linked to this source picks up the new URL — not just
      // the one card the edit was opened from.
      setClaims((cs) => cs.map((c) => (c.source_id === sourceId ? { ...c, origin_url: data.origin_url } : c)));
      setEditingSourceId(null);
      setEditValue('');
    } catch (err) {
      setEditError(String(err));
    } finally {
      setEditSaving(false);
    }
  }

  // Accomplishment-type reclassification — a plain dropdown that saves on
  // change (no separate edit/save/cancel step needed for a small enum,
  // unlike the free-text source URL editor above).
  const [typeSaving, setTypeSaving] = useState<Record<string, boolean>>({});
  const [typeError, setTypeError] = useState<Record<string, string>>({});

  async function updateType(claimId: string, newType: string) {
    setTypeSaving((s) => ({ ...s, [claimId]: true }));
    setTypeError((e) => ({ ...e, [claimId]: '' }));
    try {
      const res = await fetch(`/api/claims/${claimId}/accomplishment-type`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accomplishment_type: newType })
      });
      const data = await res.json();
      if (!res.ok) {
        setTypeError((e) => ({ ...e, [claimId]: data.error || `Request failed (${res.status})` }));
        return;
      }
      setClaims((cs) => cs.map((c) => (c.id === claimId ? { ...c, accomplishment_type: data.accomplishment_type } : c)));
    } catch (err) {
      setTypeError((e) => ({ ...e, [claimId]: String(err) }));
    } finally {
      setTypeSaving((s) => ({ ...s, [claimId]: false }));
    }
  }

  // Featured toggle (see schema.sql's claims.featured comment) — same
  // save-on-change pattern as the accomplishment-type dropdown above,
  // just a checkbox instead of a select.
  const [featuredSaving, setFeaturedSaving] = useState<Record<string, boolean>>({});

  async function updateFeatured(claimId: string, featured: boolean) {
    setFeaturedSaving((s) => ({ ...s, [claimId]: true }));
    try {
      const res = await fetch(`/api/claims/${claimId}/featured`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featured })
      });
      const data = await res.json();
      if (res.ok) {
        setClaims((cs) => cs.map((c) => (c.id === claimId ? { ...c, featured: data.featured } : c)));
      }
    } finally {
      setFeaturedSaving((s) => ({ ...s, [claimId]: false }));
    }
  }

  // "This completes an earlier claim" linking (see schema.sql's
  // completes_claim_id) — search-and-pick rather than free text, so the
  // link always points at a real claim id.
  const [linkingClaimId, setLinkingClaimId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<ClaimSearchResult[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  function startLinking(claimId: string) {
    setLinkingClaimId(claimId);
    setLinkQuery('');
    setLinkResults([]);
    setLinkError(null);
  }

  function cancelLinking() {
    setLinkingClaimId(null);
    setLinkQuery('');
    setLinkResults([]);
    setLinkError(null);
  }

  async function searchLink(claimId: string) {
    if (!linkQuery.trim()) {
      setLinkResults([]);
      return;
    }
    setLinkSearching(true);
    try {
      const res = await fetch(`/api/claims/search?q=${encodeURIComponent(linkQuery)}&exclude=${claimId}`);
      const data = await res.json();
      setLinkResults(res.ok ? data.results : []);
    } catch {
      setLinkResults([]);
    } finally {
      setLinkSearching(false);
    }
  }

  async function saveLink(claimId: string, completesClaimId: string | null, completesTitle: string | null) {
    setLinkSaving(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/completes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completes_claim_id: completesClaimId })
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error || `Request failed (${res.status})`);
        return;
      }
      setClaims((cs) =>
        cs.map((c) =>
          c.id === claimId
            ? { ...c, completes_claim_id: data.completes_claim_id, completes_claim_title: completesTitle }
            : c
        )
      );
      cancelLinking();
    } catch (err) {
      setLinkError(String(err));
    } finally {
      setLinkSaving(false);
    }
  }

  // "Clarified by admin" -- two mutually exclusive mechanisms (see
  // schema.sql's comment): 'search' links an existing ingested claim
  // (reuses the same /api/claims/search endpoint as the completes-claim
  // picker above); 'text' lets an admin write the clarification directly
  // with a source URL, for the much more common case where the real
  // clarification doesn't already exist as its own claim -- a keyword
  // search over existing titles won't find a match that was never
  // ingested, and per the client's own words, "if your LLM could not
  // find a cogent match, I dont think a human would" either.
  const [clarifyingClaimId, setClarifyingClaimId] = useState<string | null>(null);
  const [clarifyMode, setClarifyMode] = useState<'search' | 'text'>('search');
  const [clarifyQuery, setClarifyQuery] = useState('');
  const [clarifyResults, setClarifyResults] = useState<ClaimSearchResult[]>([]);
  const [clarifySearching, setClarifySearching] = useState(false);
  const [clarifyTitle, setClarifyTitle] = useState('');
  const [clarifyText, setClarifyText] = useState('');
  const [clarifyUrl, setClarifyUrl] = useState('');
  const [clarifySaving, setClarifySaving] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);

  function startClarifying(claimId: string) {
    setClarifyingClaimId(claimId);
    setClarifyMode('search');
    setClarifyQuery('');
    setClarifyResults([]);
    setClarifyTitle('');
    setClarifyText('');
    setClarifyUrl('');
    setClarifyError(null);
  }

  function cancelClarifying() {
    setClarifyingClaimId(null);
    setClarifyQuery('');
    setClarifyResults([]);
    setClarifyTitle('');
    setClarifyText('');
    setClarifyUrl('');
    setClarifyError(null);
  }

  async function searchClarify(claimId: string) {
    if (!clarifyQuery.trim()) {
      setClarifyResults([]);
      return;
    }
    setClarifySearching(true);
    try {
      const res = await fetch(`/api/claims/search?q=${encodeURIComponent(clarifyQuery)}&exclude=${claimId}`);
      const data = await res.json();
      setClarifyResults(res.ok ? data.results : []);
    } catch {
      setClarifyResults([]);
    } finally {
      setClarifySearching(false);
    }
  }

  async function saveClarification(claimId: string, clarificationClaimId: string | null, clarificationTitle: string | null) {
    setClarifySaving(true);
    setClarifyError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/clarification`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manual_clarification_id: clarificationClaimId })
      });
      const data = await res.json();
      if (!res.ok) {
        setClarifyError(data.error || `Request failed (${res.status})`);
        return;
      }
      setClaims((cs) =>
        cs.map((c) =>
          c.id === claimId
            ? {
                ...c,
                manual_clarification_id: data.manual_clarification_id,
                manual_clarification_claim_title: clarificationTitle,
                manual_clarification_title: null,
                manual_clarification_text: null,
                manual_clarification_url: null
              }
            : c
        )
      );
      cancelClarifying();
    } catch (err) {
      setClarifyError(String(err));
    } finally {
      setClarifySaving(false);
    }
  }

  async function saveClarificationText(claimId: string, clear = false) {
    setClarifySaving(true);
    setClarifyError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/clarification`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          clear
            ? { manual_clarification_title: null, manual_clarification_text: null, manual_clarification_url: null }
            : { manual_clarification_title: clarifyTitle.trim(), manual_clarification_text: clarifyText.trim(), manual_clarification_url: clarifyUrl.trim() }
        )
      });
      const data = await res.json();
      if (!res.ok) {
        setClarifyError(data.error || `Request failed (${res.status})`);
        return;
      }
      setClaims((cs) =>
        cs.map((c) =>
          c.id === claimId
            ? {
                ...c,
                manual_clarification_id: null,
                manual_clarification_claim_title: null,
                manual_clarification_title: data.manual_clarification_title,
                manual_clarification_text: data.manual_clarification_text,
                manual_clarification_url: data.manual_clarification_url
              }
            : c
        )
      );
      cancelClarifying();
    } catch (err) {
      setClarifyError(String(err));
    } finally {
      setClarifySaving(false);
    }
  }

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
                {c.stance === 'opposition_statement' ? (
                  <span className={`${styles.tag} ${styles.tagOpposition}`}>Opposition</span>
                ) : (
                  <select
                    className={`${styles.tag} ${styles.tagAccomplishment} ${styles.typeSelect}`}
                    value={c.accomplishment_type ?? ''}
                    disabled={!!typeSaving[c.id]}
                    onChange={(e) => updateType(c.id, e.target.value)}
                    title="Reclassify if this doesn't quite fit"
                  >
                    {!c.accomplishment_type && <option value="">Accomplishment (unset)</option>}
                    {ACCOMPLISHMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
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
                <label
                  className={styles.tag}
                  style={{ background: c.featured ? 'var(--paper-2)' : 'var(--red-tint)', color: c.featured ? 'var(--muted)' : 'var(--red-ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  title="Uncheck for a real, sourced claim that's still not right for the curated Dashboard/Timeline (an isolated incident, not a policy/initiative) — it stays fully approved and searchable in Ask the Record either way."
                >
                  <input
                    type="checkbox"
                    checked={c.featured}
                    disabled={!!featuredSaving[c.id]}
                    onChange={(e) => updateFeatured(c.id, e.target.checked)}
                  />
                  {c.featured ? 'Featured' : 'Hidden from Dashboard'}
                </label>
              </div>
              {typeError[c.id] && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{typeError[c.id]}</div>}

              <h3 className={styles.title}>{c.title}</h3>
              <p className={styles.summary}>{c.summary}</p>

              {c.stance === 'accomplishment' && (
                <div className={styles.srcLine}>
                  {c.completes_claim_id ? (
                    <>
                      ✓ Completes:{' '}
                      <a href={`/claim/${c.completes_claim_id}`} target="_blank" rel="noreferrer">
                        {c.completes_claim_title ?? 'linked claim'}
                      </a>{' '}
                      &middot;{' '}
                      <span className={styles.editLink} onClick={() => saveLink(c.id, null, null)}>
                        unlink
                      </span>
                    </>
                  ) : (
                    <span className={styles.editLink} onClick={() => startLinking(c.id)}>
                      link as completing an earlier claim
                    </span>
                  )}
                </div>
              )}

              {linkingClaimId === c.id && (
                <div className={styles.editBlock}>
                  <input
                    className={styles.editInput}
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchLink(c.id)}
                    placeholder="Search earlier claim titles…"
                    disabled={linkSaving}
                  />
                  <div className={styles.editActions}>
                    <button className={`${styles.btn} ${styles.btnApprove}`} disabled={linkSearching} onClick={() => searchLink(c.id)}>
                      {linkSearching ? 'Searching…' : 'Search'}
                    </button>
                    <button className={`${styles.btn} ${styles.btnReject}`} disabled={linkSaving} onClick={cancelLinking}>
                      Cancel
                    </button>
                  </div>
                  {linkResults.length > 0 && (
                    <ul className={styles.linkResults}>
                      {linkResults.map((r) => (
                        <li key={r.id}>
                          <span className={styles.editLink} onClick={() => saveLink(c.id, r.id, r.title)}>
                            {r.title} {r.event_date ? `(${r.event_date})` : ''} — {accomplishmentTypeLabel(r.accomplishment_type)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {linkError && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{linkError}</div>}
                </div>
              )}

              {c.stance === 'opposition_statement' && (
                <div className={styles.srcLine}>
                  {c.manual_clarification_id ? (
                    <>
                      ✓ Clarified by admin:{' '}
                      <a href={`/claim/${c.manual_clarification_id}`} target="_blank" rel="noreferrer">
                        {c.manual_clarification_claim_title ?? 'linked claim'}
                      </a>{' '}
                      &middot;{' '}
                      <span className={styles.editLink} onClick={() => saveClarification(c.id, null, null)}>
                        unlink
                      </span>
                    </>
                  ) : c.manual_clarification_url ? (
                    <>
                      ✓ Clarified by admin (written):{' '}
                      <a href={c.manual_clarification_url} target="_blank" rel="noreferrer">
                        {c.manual_clarification_title ?? 'view source'}
                      </a>{' '}
                      &middot;{' '}
                      <span className={styles.editLink} onClick={() => saveClarificationText(c.id, true)}>
                        remove
                      </span>
                    </>
                  ) : (
                    <span className={styles.editLink} onClick={() => startClarifying(c.id)}>
                      add the government's own clarification
                    </span>
                  )}
                </div>
              )}

              {clarifyingClaimId === c.id && (
                <div className={styles.editBlock}>
                  <div className={styles.editActions} style={{ marginBottom: 8 }}>
                    <button
                      className={`${styles.btn} ${clarifyMode === 'search' ? styles.btnApprove : ''}`}
                      onClick={() => setClarifyMode('search')}
                    >
                      Link an existing claim
                    </button>
                    <button
                      className={`${styles.btn} ${clarifyMode === 'text' ? styles.btnApprove : ''}`}
                      onClick={() => setClarifyMode('text')}
                    >
                      Write a clarification
                    </button>
                  </div>

                  {clarifyMode === 'search' ? (
                    <>
                      <input
                        className={styles.editInput}
                        value={clarifyQuery}
                        onChange={(e) => setClarifyQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchClarify(c.id)}
                        placeholder="Search accomplishment claim titles…"
                        disabled={clarifySaving}
                      />
                      <div className={styles.editActions}>
                        <button className={`${styles.btn} ${styles.btnApprove}`} disabled={clarifySearching} onClick={() => searchClarify(c.id)}>
                          {clarifySearching ? 'Searching…' : 'Search'}
                        </button>
                        <button className={`${styles.btn} ${styles.btnReject}`} disabled={clarifySaving} onClick={cancelClarifying}>
                          Cancel
                        </button>
                      </div>
                      {clarifyResults.length > 0 && (
                        <ul className={styles.linkResults}>
                          {clarifyResults.map((r) => (
                            <li key={r.id}>
                              <span className={styles.editLink} onClick={() => saveClarification(c.id, r.id, r.title)}>
                                {r.title} {r.event_date ? `(${r.event_date})` : ''} — {accomplishmentTypeLabel(r.accomplishment_type)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        className={styles.editInput}
                        value={clarifyTitle}
                        onChange={(e) => setClarifyTitle(e.target.value)}
                        placeholder="Short title, e.g. 'Water infrastructure investment in Cayon'"
                        disabled={clarifySaving}
                      />
                      <textarea
                        className={styles.editInput}
                        value={clarifyText}
                        onChange={(e) => setClarifyText(e.target.value)}
                        placeholder="What is the government's response to this claim?"
                        rows={3}
                        disabled={clarifySaving}
                      />
                      <input
                        className={styles.editInput}
                        value={clarifyUrl}
                        onChange={(e) => setClarifyUrl(e.target.value)}
                        placeholder="Source URL (required) — where can this be verified?"
                        disabled={clarifySaving}
                      />
                      <div className={styles.editActions}>
                        <button
                          className={`${styles.btn} ${styles.btnApprove}`}
                          disabled={clarifySaving || !clarifyUrl.trim()}
                          onClick={() => saveClarificationText(c.id)}
                        >
                          {clarifySaving ? 'Saving…' : 'Save'}
                        </button>
                        <button className={`${styles.btn} ${styles.btnReject}`} disabled={clarifySaving} onClick={cancelClarifying}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                  {clarifyError && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{clarifyError}</div>}
                </div>
              )}

              <div className={styles.srcLine}>
                {c.source_type} — {c.speaker_org} — {c.source_title} &middot;{' '}
                <a href={c.origin_url} target="_blank" rel="noreferrer">
                  view source
                </a>{' '}
                &middot;{' '}
                <span className={styles.editLink} onClick={() => startEditingSource(c)}>
                  edit source URL
                </span>
                {c.source_claim_count > 1 && (
                  <span className={styles.sharedNote}>
                    {' '}
                    (shared by {c.source_claim_count} claims)
                  </span>
                )}
              </div>

              {editingSourceId === c.source_id && (
                <div className={styles.editBlock}>
                  <input
                    className={styles.editInput}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="https://facebook.com/..."
                    disabled={editSaving}
                  />
                  <div className={styles.editActions}>
                    <button
                      className={`${styles.btn} ${styles.btnApprove}`}
                      disabled={editSaving}
                      onClick={() => saveSourceUrl(c.source_id)}
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button className={`${styles.btn} ${styles.btnReject}`} disabled={editSaving} onClick={cancelEditingSource}>
                      Cancel
                    </button>
                  </div>
                  {c.source_claim_count > 1 && (
                    <div className={styles.suggestNote}>
                      This source is linked to {c.source_claim_count} claims — saving updates the URL for all of them,
                      since they came from the same post.
                    </div>
                  )}
                  {editError && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{editError}</div>}
                </div>
              )}

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
