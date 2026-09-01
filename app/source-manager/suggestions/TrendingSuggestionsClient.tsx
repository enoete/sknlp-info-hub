'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './trending-suggestions.module.css';
import { getCategoryColor } from '@/app/lib/categoryColors';
import type { SuggestionTheme } from '@/app/lib/citizenSuggestions';

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  under_consideration: 'Under consideration'
};
const STATUS_CLASS: Record<string, string> = {
  new: styles.statusNew,
  under_consideration: styles.statusUnderConsideration
};

function ThemeCard({ theme, maxCount }: { theme: SuggestionTheme; maxCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [officialName, setOfficialName] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryColor = getCategoryColor(theme.category);
  const barWidth = maxCount > 0 ? Math.max(6, Math.round((theme.mention_count / maxCount) * 100)) : 0;

  async function handleAcknowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!officialName.trim() || !comment.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions/themes/${theme.id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ official_name: officialName.trim(), comment: comment.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Could not save (${res.status})`);
      } else {
        setOfficialName('');
        setComment('');
        router.refresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.themeHead} onClick={() => setOpen((o) => !o)}>
        <div className={styles.themeLeft}>
          <h3 className={styles.themeLabel}>{theme.label}</h3>
          <div className={styles.metaRow}>
            {theme.category && (
              <span className={styles.categoryTag} style={{ background: categoryColor.tint, color: categoryColor.ink }}>
                {theme.category}
              </span>
            )}
            <span className={`${styles.statusPill} ${STATUS_CLASS[theme.status] ?? ''}`}>
              {STATUS_LABEL[theme.status] ?? theme.status}
            </span>
          </div>
          <div className={styles.trendBarWrap}>
            <div className={styles.trendBar} style={{ width: `${barWidth}%` }} />
          </div>
        </div>
        <div className={styles.mentionCount}>{theme.mention_count} mention{theme.mention_count === 1 ? '' : 's'}</div>
        <div className={styles.expandIcon}>{open ? '▲' : '▼'}</div>
      </div>

      {open && (
        <div className={styles.detail}>
          <div className={styles.sectionLabel}>Recent submissions (raw text)</div>
          {theme.sample_texts.map((t, i) => (
            <div className={styles.sample} key={i}>
              &ldquo;{t}&rdquo;
            </div>
          ))}

          {theme.acknowledgements.length > 0 && (
            <>
              <div className={styles.sectionLabel} style={{ marginTop: 14 }}>
                Official response
              </div>
              {theme.acknowledgements.map((a) => (
                <div className={styles.ack} key={a.id}>
                  <div className={styles.ackHead}>
                    {a.official_name} · {a.created_at}
                  </div>
                  <div className={styles.ackComment}>{a.comment}</div>
                </div>
              ))}
            </>
          )}

          <div className={styles.sectionLabel} style={{ marginTop: 14 }}>
            Acknowledge &amp; submit for further consideration
          </div>
          <form className={styles.ackForm} onSubmit={handleAcknowledge}>
            <input
              className={styles.textInput}
              placeholder="Your name / title (e.g. Min. Isalean Phillip)"
              value={officialName}
              onChange={(e) => setOfficialName(e.target.value)}
            />
            <textarea
              className={styles.textInput}
              placeholder="Comment for the record — what's the government's response to this?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {error && <div className={styles.formError}>{error}</div>}
            <div className={styles.ackFormActions}>
              <button type="submit" className={styles.btnPrimary} disabled={saving || !officialName.trim() || !comment.trim()}>
                {saving ? 'Saving…' : 'Acknowledge & submit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function TrendingSuggestionsClient({ themes }: { themes: SuggestionTheme[] }) {
  if (themes.length === 0) {
    return (
      <div className={styles.emptyState}>
        No suggestions submitted yet. The public form is at <code>/suggest</code> — once citizens
        start submitting, related suggestions will cluster together here automatically.
      </div>
    );
  }

  const maxCount = Math.max(...themes.map((t) => t.mention_count));
  return (
    <div>
      {themes.map((t) => (
        <ThemeCard theme={t} maxCount={maxCount} key={t.id} />
      ))}
    </div>
  );
}
