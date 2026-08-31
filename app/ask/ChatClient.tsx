'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './chat.module.css';
import { sourceLinkLabel } from '@/app/lib/youtube';

interface Citation {
  source_type?: string;
  speaker_org?: string;
  source_title?: string;
  url?: string;
  published_at?: string;
}

interface AskResponse {
  found: boolean;
  claim_title?: string;
  summary?: string;
  stance?: string;
  citation?: Citation;
  no_record_message?: string;
  retrieval_count?: number;
  retrieved_titles?: string[];
  follow_up_suggestions?: string[];
  error?: string;
}

interface ChatMessage {
  role: 'user' | 'bot';
  question?: string;
  answer?: AskResponse;
  errorText?: string;
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

export default function ChatClient({ suggestions }: { suggestions: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Starts as the dynamic starting suggestions from the page; replaced with
  // context-aware follow-ups after each answered question (see ask() below).
  // A no-record answer, or one with no same-category follow-ups available,
  // leaves whatever was showing in place rather than clearing it — no
  // suggestion pill is ever shown that wasn't derived from a real claim.
  const [currentSuggestions, setCurrentSuggestions] = useState<string[]>(suggestions);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Runs on every new message AND on the loading flag, so the "Searching
  // the record…" line and the eventual answer are both scrolled into view
  // without the person ever having to scroll the log by hand.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', question }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question })
      });

      let data: any;
      try {
        data = await res.json();
      } catch (parseErr) {
        // Not our API's doing — e.g. nginx's own HTML error page during a
        // brief upstream outage (502/504), which isn't JSON at all. A raw
        // "Unexpected token '<'" means nothing to a real visitor; log it
        // for debugging and show a plain, generic message instead.
        console.error('Failed to parse /api/ask response as JSON:', parseErr);
        setMessages((m) => [...m, { role: 'bot', errorText: GENERIC_ERROR }]);
        return;
      }

      if (!res.ok) {
        // A real, structured error from our own API (rate limit, missing
        // key, etc.) — data.error is already a deliberate, human-readable
        // message, safe to show as-is.
        setMessages((m) => [...m, { role: 'bot', errorText: data.error || `Request failed (${res.status})` }]);
      } else {
        setMessages((m) => [...m, { role: 'bot', answer: data }]);
        if (data.follow_up_suggestions?.length > 0) {
          setCurrentSuggestions(data.follow_up_suggestions);
        }
      }
    } catch (err) {
      // Network-level failure (connection dropped, DNS, etc.) — same
      // reasoning as above: log the real cause, never show it raw.
      console.error('Network error calling /api/ask:', err);
      setMessages((m) => [...m, { role: 'bot', errorText: GENERIC_ERROR }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Ask the record</div>
        <h1>VERIFY ANYTHING YOU&apos;VE HEARD</h1>
        <p>
          This isn&apos;t a neutral opinion — it&apos;s an index. It only answers from documented, dated
          sources, and says so plainly when nothing&apos;s on file.
        </p>
      </div>

      <div className={styles.chatShell}>
        <div className={styles.chatLog}>
          {messages.length === 0 && (
            <p style={{ color: 'var(--faint)', fontSize: 13 }}>
              Ask a question below, or try one of the suggestions.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className={`${styles.msg} ${styles.msgUser}`}>
                <div className={styles.bubble}>{m.question}</div>
              </div>
            ) : (
              <div key={i} className={styles.msg}>
                {m.errorText ? (
                  <div className={styles.errorBox}>Error: {m.errorText}</div>
                ) : m.answer?.found ? (
                  <div className={styles.answerCard}>
                    <span
                      className={`${styles.aStance} ${
                        m.answer.stance === 'opposition_statement'
                          ? styles.aStanceOpposition
                          : styles.aStanceAccomplishment
                      }`}
                    >
                      {m.answer.stance === 'opposition_statement' ? 'Opposition statement' : 'Accomplishment'}
                    </span>
                    <div className={styles.aTitle}>{m.answer.claim_title}</div>
                    <p className={styles.aSummary}>{m.answer.summary}</p>
                    <div className={styles.aCite}>
                      <span className={styles.aCiteMeta}>
                        <b>{m.answer.citation?.source_type}</b> — {m.answer.citation?.speaker_org} —{' '}
                        {m.answer.citation?.source_title}
                        {m.answer.citation?.published_at ? ` · ${m.answer.citation.published_at}` : ''}
                      </span>
                      <a className={styles.tsLink} href={m.answer.citation?.url} target="_blank" rel="noreferrer">
                        {sourceLinkLabel(m.answer.citation?.url)}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className={styles.answerCard}>
                    <div className={styles.noRecord}>
                      {m.answer?.no_record_message ||
                        "I don't have an official record of that in the archive."}
                    </div>
                  </div>
                )}
              </div>
            )
          )}
          {loading && <div className={styles.debugLine}>Searching the record…</div>}
          <div ref={bottomRef} />
        </div>

        <div className={styles.suggestionRow}>
          {currentSuggestions.map((s) => (
            <span key={s} className={styles.suggestion} onClick={() => ask(s)}>
              {s}
            </span>
          ))}
        </div>

        <form
          className={styles.chatInputRow}
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about anything you've heard…"
          />
          <button type="submit" disabled={loading}>
            Search record
          </button>
        </form>
        <div className={styles.privacyNote}>
          Nothing you ask here is linked to your identity — ask freely.
        </div>
      </div>
    </>
  );
}
