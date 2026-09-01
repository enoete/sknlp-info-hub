'use client';

import { useState } from 'react';
import styles from './suggest.module.css';

const MAX_LENGTH = 500;

export default function SuggestForm() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error || `Could not submit (${res.status})` });
      } else {
        setMessage({ kind: 'ok', text: 'Thank you — your suggestion has been recorded.' });
        setText('');
      }
    } catch (err) {
      setMessage({ kind: 'error', text: String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit}>
      <label className={styles.formLabel} htmlFor="suggestion-text">
        What would you like the government to focus on?
      </label>
      <textarea
        id="suggestion-text"
        className={styles.textInput}
        placeholder="e.g. Better bus routes connecting Sandy Point to Basseterre"
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.charCount}>
        {text.length}/{MAX_LENGTH}
      </div>

      {message && <div className={message.kind === 'ok' ? styles.formSuccess : styles.formError}>{message.text}</div>}

      <div className={styles.formActions}>
        <button type="submit" className={styles.btnPrimary} disabled={submitting || !text.trim()}>
          {submitting ? 'Submitting…' : 'Submit suggestion'}
        </button>
      </div>

      <div className={styles.anonNote}>
        🔒 Anonymous — not linked to your identity or IP address. This is a content log, not a tracking log.
      </div>
    </form>
  );
}
