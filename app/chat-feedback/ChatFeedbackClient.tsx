'use client';

import { useMemo, useState } from 'react';
import styles from './chat-feedback.module.css';
import type { ChatQueryLogRow, MostClickedSuggestion, FeedbackRating } from '@/app/lib/chatQueries';
import type { ClaimSearchResult } from '@/app/lib/reviewQueue';

type RatingFilter = 'all' | 'unreviewed' | FeedbackRating;

const RATING_TABS: { value: RatingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unreviewed', label: 'Not yet reviewed' },
  { value: 'fully_answered', label: 'Fully answered' },
  { value: 'partially_answered', label: 'Partially answered' },
  { value: 'not_answered', label: 'Not answered' }
];

const RATING_LABEL: Record<FeedbackRating, string> = {
  fully_answered: 'Fully answered',
  partially_answered: 'Partially answered',
  not_answered: 'Not answered'
};

const RATING_BASE_CLASS: Record<FeedbackRating, string> = {
  fully_answered: styles.ratingBtnFully,
  partially_answered: styles.ratingBtnPartial,
  not_answered: styles.ratingBtnNot
};

const RATING_BTN_ACTIVE_CLASS: Record<FeedbackRating, string> = {
  fully_answered: styles.ratingBtnActiveFully,
  partially_answered: styles.ratingBtnActivePartial,
  not_answered: styles.ratingBtnActiveNot
};

const RATING_TAG_CLASS: Record<FeedbackRating, string> = {
  fully_answered: styles.tagRatingFully,
  partially_answered: styles.tagRatingPartial,
  not_answered: styles.tagRatingNot
};

// No admin auth exists yet (see CLAUDE.md) -- the real per-user login
// this stands in for will replace this constant outright, not extend it
// with a name field on every rating.
const DEFAULT_REVIEWER = 'admin';

type OriginFilter = 'all' | 'suggestion' | 'typed';

const ORIGIN_TABS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'All questions' },
  { value: 'suggestion', label: 'Pre-Filled Suggested Questions' },
  { value: 'typed', label: 'Typed by visitor' }
];

export default function ChatFeedbackClient({
  initialLog,
  mostClicked
}: {
  initialLog: ChatQueryLogRow[];
  mostClicked: MostClickedSuggestion[];
}) {
  const [log, setLog] = useState(initialLog);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');

  // Rating form -- one row's pending rating/context, keyed by
  // chat_queries.id, seeded from whatever was already saved so re-opening
  // a reviewed row doesn't blank it out. No reviewer-name field: there's
  // no real admin auth yet (see CLAUDE.md), so every rating is attributed
  // to the constant DEFAULT_REVIEWER below rather than asking for a name
  // on every single click -- a real login will replace this outright once
  // one exists, not extend it.
  const [pendingRating, setPendingRating] = useState<Record<string, FeedbackRating | null>>({});
  const [pendingContext, setPendingContext] = useState<Record<string, string>>({});
  const [ratingSaving, setRatingSaving] = useState<Record<string, boolean>>({});
  const [ratingError, setRatingError] = useState<Record<string, string>>({});

  function ratingFor(id: string, row: ChatQueryLogRow): FeedbackRating | null {
    return id in pendingRating ? pendingRating[id] : row.feedback_rating;
  }
  function contextFor(id: string, row: ChatQueryLogRow): string {
    return id in pendingContext ? pendingContext[id] : row.feedback_context ?? '';
  }

  // Saves immediately -- no separate "Save rating" button. rating=null
  // clears it (unrating). context is only ever persisted alongside
  // 'partially_answered'; any other rating always clears it server-side,
  // matching submitChatFeedback's own posture (context is a note on WHY
  // a partial miss happened, meaningless for the other two ratings).
  async function applyRating(id: string, rating: FeedbackRating | null, context: string) {
    setRatingSaving((s) => ({ ...s, [id]: true }));
    setRatingError((e) => ({ ...e, [id]: '' }));
    const savedContext = rating === 'partially_answered' ? context.trim() : '';
    try {
      const res = await fetch(`/api/chat-feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          feedback_rating: rating,
          feedback_context: savedContext,
          feedback_reviewed_by: rating ? DEFAULT_REVIEWER : null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setRatingError((e) => ({ ...e, [id]: data.error || `Request failed (${res.status})` }));
        return;
      }
      setLog((rows) =>
        rows.map((r) =>
          r.id === id
            ? {
                ...r,
                feedback_rating: rating,
                feedback_context: savedContext || null,
                feedback_reviewed_by: rating ? DEFAULT_REVIEWER : null,
                feedback_reviewed_at: new Date().toISOString()
              }
            : r
        )
      );
    } catch (err) {
      setRatingError((e) => ({ ...e, [id]: String(err) }));
    } finally {
      setRatingSaving((s) => ({ ...s, [id]: false }));
    }
  }

  // Clicking a rating pill saves immediately -- clicking the already-
  // active one un-rates it. The confirmation log line below the buttons
  // (driven directly off r.feedback_rating, not a separate transient
  // flag) is what tells the admin the click actually took and what it
  // recorded, replacing the old explicit "Save rating" button.
  function pickRating(id: string, row: ChatQueryLogRow, rating: FeedbackRating) {
    const next = ratingFor(id, row) === rating ? null : rating;
    setPendingRating((p) => ({ ...p, [id]: next }));
    applyRating(id, next, contextFor(id, row));
  }

  // The guidance-note textarea (partially_answered only) can't sensibly
  // auto-save per keystroke, so it saves on blur instead -- still no
  // explicit button, just "finish typing and click elsewhere."
  function saveContextOnBlur(id: string, row: ChatQueryLogRow) {
    const rating = ratingFor(id, row);
    if (rating !== 'partially_answered') return;
    applyRating(id, rating, contextFor(id, row));
  }

  // "Link the actually correct claim" / "write the correct answer" --
  // mirrors the Review Queue's manual-clarification picker exactly (same
  // two mutually exclusive mechanisms, same /api/claims/search endpoint,
  // now with stance=any since a chatbot answer can cite either side).
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctMode, setCorrectMode] = useState<'search' | 'text'>('search');
  const [correctQuery, setCorrectQuery] = useState('');
  const [correctResults, setCorrectResults] = useState<ClaimSearchResult[]>([]);
  const [correctSearching, setCorrectSearching] = useState(false);
  const [correctTitle, setCorrectTitle] = useState('');
  const [correctText, setCorrectText] = useState('');
  const [correctUrl, setCorrectUrl] = useState('');
  const [correctSaving, setCorrectSaving] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  function startCorrecting(id: string) {
    setCorrectingId(id);
    setCorrectMode('search');
    setCorrectQuery('');
    setCorrectResults([]);
    setCorrectTitle('');
    setCorrectText('');
    setCorrectUrl('');
    setCorrectError(null);
  }
  function cancelCorrecting() {
    setCorrectingId(null);
    setCorrectQuery('');
    setCorrectResults([]);
    setCorrectError(null);
  }

  async function searchCorrect() {
    if (!correctQuery.trim()) {
      setCorrectResults([]);
      return;
    }
    setCorrectSearching(true);
    try {
      const res = await fetch(`/api/claims/search?q=${encodeURIComponent(correctQuery)}&stance=any`);
      const data = await res.json();
      setCorrectResults(res.ok ? data.results : []);
    } catch {
      setCorrectResults([]);
    } finally {
      setCorrectSearching(false);
    }
  }

  async function saveCorrectClaim(id: string, claimId: string | null, claimTitle: string | null) {
    setCorrectSaving(true);
    setCorrectError(null);
    try {
      const res = await fetch(`/api/chat-feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback_claim_id: claimId })
      });
      const data = await res.json();
      if (!res.ok) {
        setCorrectError(data.error || `Request failed (${res.status})`);
        return;
      }
      setLog((rows) =>
        rows.map((r) =>
          r.id === id
            ? {
                ...r,
                feedback_claim_id: data.feedback_claim_id,
                feedback_claim_title: claimTitle,
                feedback_correction_title: null,
                feedback_correction_text: null,
                feedback_correction_url: null
              }
            : r
        )
      );
      cancelCorrecting();
    } catch (err) {
      setCorrectError(String(err));
    } finally {
      setCorrectSaving(false);
    }
  }

  async function saveCorrectText(id: string, clear = false) {
    setCorrectSaving(true);
    setCorrectError(null);
    try {
      const res = await fetch(`/api/chat-feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          clear
            ? { feedback_correction_title: null, feedback_correction_text: null, feedback_correction_url: null }
            : {
                feedback_correction_title: correctTitle.trim(),
                feedback_correction_text: correctText.trim(),
                feedback_correction_url: correctUrl.trim()
              }
        )
      });
      const data = await res.json();
      if (!res.ok) {
        setCorrectError(data.error || `Request failed (${res.status})`);
        return;
      }
      setLog((rows) =>
        rows.map((r) =>
          r.id === id
            ? {
                ...r,
                feedback_claim_id: null,
                feedback_claim_title: null,
                feedback_correction_title: data.feedback_correction_title,
                feedback_correction_text: data.feedback_correction_text,
                feedback_correction_url: data.feedback_correction_url
              }
            : r
        )
      );
      cancelCorrecting();
    } catch (err) {
      setCorrectError(String(err));
    } finally {
      setCorrectSaving(false);
    }
  }

  const filtered = useMemo(() => {
    return log.filter((r) => {
      if (originFilter === 'suggestion' && !r.is_suggestion) return false;
      if (originFilter === 'typed' && r.is_suggestion) return false;
      if (ratingFilter === 'all') return true;
      if (ratingFilter === 'unreviewed') return r.feedback_rating === null;
      return r.feedback_rating === ratingFilter;
    });
  }, [log, ratingFilter, originFilter]);

  const counts = useMemo(() => {
    const base =
      originFilter === 'all' ? log : log.filter((r) => (originFilter === 'suggestion' ? r.is_suggestion : !r.is_suggestion));
    return {
      all: base.length,
      unreviewed: base.filter((r) => r.feedback_rating === null).length,
      fully_answered: base.filter((r) => r.feedback_rating === 'fully_answered').length,
      partially_answered: base.filter((r) => r.feedback_rating === 'partially_answered').length,
      not_answered: base.filter((r) => r.feedback_rating === 'not_answered').length
    };
  }, [log, originFilter]);

  const originCounts = useMemo(
    () => ({
      all: log.length,
      suggestion: log.filter((r) => r.is_suggestion).length,
      typed: log.filter((r) => !r.is_suggestion).length
    }),
    [log]
  );

  return (
    <>
      <div className={styles.clickedPanel}>
        <div className={styles.clickedTitle}>Most-clicked suggestions</div>
        {mostClicked.length === 0 ? (
          <div className={styles.clickedEmpty}>No suggestion pills have been clicked yet.</div>
        ) : (
          <ul className={styles.clickedList}>
            {mostClicked.map((m) => (
              <li key={m.question} className={styles.clickedRow}>
                <span className={styles.clickedCount}>{m.click_count}×</span>
                <span className={styles.clickedQuestion}>{m.question}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.filterRow}>
        {RATING_TABS.map((t) => (
          <span
            key={t.value}
            className={`${styles.pill} ${ratingFilter === t.value ? styles.pillActive : ''}`}
            onClick={() => setRatingFilter(t.value)}
          >
            {t.label} ({counts[t.value]})
          </span>
        ))}
      </div>
      <div className={styles.filterRow}>
        {ORIGIN_TABS.map((t) => (
          <span
            key={t.value}
            className={`${styles.pill} ${originFilter === t.value ? styles.pillActive : ''}`}
            onClick={() => setOriginFilter(t.value)}
          >
            {t.label} ({originCounts[t.value]})
          </span>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No questions match this filter yet.</div>
      ) : (
        filtered.map((r) => {
          const rating = ratingFor(r.id, r);
          const needsCorrection = rating === 'not_answered' || rating === 'partially_answered';

          return (
            <div key={r.id} className={`${styles.card} ${r.is_suggestion ? styles.cardSuggestion : styles.cardTyped}`}>
              <div className={styles.metaRow}>
                {r.is_suggestion ? (
                  <span className={`${styles.tag} ${styles.tagSuggestion}`}>◆ Pre-Filled Suggested Question</span>
                ) : (
                  <span className={`${styles.tag} ${styles.tagTyped}`}>⌨ Typed by visitor</span>
                )}
                <span className={`${styles.tag} ${r.found ? styles.tagFound : styles.tagNotFound}`}>
                  {r.found ? 'Bot answered' : 'No record found'}
                </span>
                {r.feedback_rating && (
                  <span className={`${styles.tag} ${RATING_TAG_CLASS[r.feedback_rating]}`}>
                    {RATING_LABEL[r.feedback_rating]}
                  </span>
                )}
                <span className={styles.timestamp}>{r.created_at}</span>
              </div>

              <p className={styles.question}>{r.question}</p>

              <div className={r.answer_text ? styles.answerBox : `${styles.answerBox} ${styles.answerBoxEmpty}`}>
                {r.answer_text ?? 'No answer text was recorded for this question (logged before this feature existed).'}
              </div>

              <div className={styles.citedLine}>
                {r.claim_id ? (
                  <>
                    Cited:{' '}
                    <a href={`/claim/${r.claim_id}`} target="_blank" rel="noreferrer">
                      {r.claim_title}
                    </a>{' '}
                    ({r.claim_stance === 'opposition_statement' ? 'opposition statement' : 'accomplishment'})
                  </>
                ) : (
                  'No claim was cited.'
                )}
              </div>

              <div className={styles.ratingRow}>
                {(Object.keys(RATING_LABEL) as FeedbackRating[]).map((val) => (
                  <button
                    key={val}
                    className={`${styles.ratingBtn} ${RATING_BASE_CLASS[val]} ${
                      rating === val ? RATING_BTN_ACTIVE_CLASS[val] : ''
                    }`}
                    disabled={!!ratingSaving[r.id]}
                    onClick={() => pickRating(r.id, r, val)}
                  >
                    {RATING_LABEL[val]}
                  </button>
                ))}
              </div>

              {rating === 'partially_answered' && (
                <textarea
                  className={styles.editInput}
                  value={contextFor(r.id, r)}
                  onChange={(e) => setPendingContext((p) => ({ ...p, [r.id]: e.target.value }))}
                  onBlur={() => saveContextOnBlur(r.id, r)}
                  placeholder="What should this have searched for? Guides retrieval the next time a similarly-worded question comes in. Saves automatically when you click away."
                  rows={2}
                  disabled={!!ratingSaving[r.id]}
                />
              )}

              {ratingError[r.id] && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{ratingError[r.id]}</div>}
              {!ratingError[r.id] && r.feedback_rating && (
                <div className={styles.savedLog}>
                  ✓ Rated &ldquo;{RATING_LABEL[r.feedback_rating]}&rdquo;{ratingSaving[r.id] ? ' — saving…' : ' — saved.'}
                </div>
              )}

              {needsCorrection && (
                <>
                  {r.feedback_claim_id ? (
                    <div className={styles.correctionLine}>
                      ✓ Correct answer linked:{' '}
                      <a href={`/claim/${r.feedback_claim_id}`} target="_blank" rel="noreferrer">
                        {r.feedback_claim_title ?? 'linked claim'}
                      </a>{' '}
                      &middot;{' '}
                      <span className={styles.editLink} onClick={() => saveCorrectClaim(r.id, null, null)}>
                        unlink
                      </span>
                    </div>
                  ) : r.feedback_correction_url ? (
                    <div className={styles.correctionLine}>
                      ✓ Correct answer (written):{' '}
                      <a href={r.feedback_correction_url} target="_blank" rel="noreferrer">
                        {r.feedback_correction_title ?? 'view source'}
                      </a>{' '}
                      &middot;{' '}
                      <span className={styles.editLink} onClick={() => saveCorrectText(r.id, true)}>
                        remove
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className={styles.editLink} onClick={() => startCorrecting(r.id)}>
                        find or write the correct answer
                      </span>
                    </div>
                  )}

                  {correctingId === r.id && (
                    <div className={styles.editBlock}>
                      <div className={styles.editActions} style={{ marginBottom: 8 }}>
                        <button
                          className={`${styles.btn} ${correctMode === 'search' ? styles.btnApprove : ''}`}
                          onClick={() => setCorrectMode('search')}
                        >
                          Link an existing claim
                        </button>
                        <button
                          className={`${styles.btn} ${correctMode === 'text' ? styles.btnApprove : ''}`}
                          onClick={() => setCorrectMode('text')}
                        >
                          Add as a new source
                        </button>
                      </div>

                      {correctMode === 'search' ? (
                        <>
                          <input
                            className={styles.editInput}
                            value={correctQuery}
                            onChange={(e) => setCorrectQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && searchCorrect()}
                            placeholder="Search approved claim titles…"
                            disabled={correctSaving}
                          />
                          <div className={styles.editActions}>
                            <button className={`${styles.btn} ${styles.btnApprove}`} disabled={correctSearching} onClick={searchCorrect}>
                              {correctSearching ? 'Searching…' : 'Search'}
                            </button>
                            <button className={`${styles.btn} ${styles.btnReject}`} disabled={correctSaving} onClick={cancelCorrecting}>
                              Cancel
                            </button>
                          </div>
                          {correctResults.length > 0 && (
                            <ul className={styles.linkResults}>
                              {correctResults.map((res) => (
                                <li key={res.id}>
                                  <span className={styles.editLink} onClick={() => saveCorrectClaim(r.id, res.id, res.title)}>
                                    {res.title} {res.event_date ? `(${res.event_date})` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <>
                          <div className={styles.editHint}>
                            No matching claim in the archive yet — write the correct answer directly, same as an
                            admin-written Opposition Watch clarification. A source URL is required.
                          </div>
                          <input
                            className={styles.editInput}
                            value={correctTitle}
                            onChange={(e) => setCorrectTitle(e.target.value)}
                            placeholder="Short title"
                            disabled={correctSaving}
                          />
                          <textarea
                            className={styles.editInput}
                            value={correctText}
                            onChange={(e) => setCorrectText(e.target.value)}
                            placeholder="What's the actual, correct, sourced answer?"
                            rows={3}
                            disabled={correctSaving}
                          />
                          <input
                            className={styles.editInput}
                            value={correctUrl}
                            onChange={(e) => setCorrectUrl(e.target.value)}
                            placeholder="Source URL (required)"
                            disabled={correctSaving}
                          />
                          <div className={styles.editActions}>
                            <button
                              className={`${styles.btn} ${styles.btnApprove}`}
                              disabled={correctSaving || !correctUrl.trim()}
                              onClick={() => saveCorrectText(r.id)}
                            >
                              {correctSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button className={`${styles.btn} ${styles.btnReject}`} disabled={correctSaving} onClick={cancelCorrecting}>
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                      {correctError && <div className={`${styles.decisionNote} ${styles.decisionError}`}>{correctError}</div>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
