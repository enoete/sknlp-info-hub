'use client';

import { useState } from 'react';
import styles from './chat.module.css';

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
  error?: string;
}

interface ChatMessage {
  role: 'user' | 'bot';
  question?: string;
  answer?: AskResponse;
  errorText?: string;
}

const SUGGESTIONS = [
  'Did the minimum wage actually increase?',
  'Did the government build a new international airport?',
  "Is it true crime has doubled since 2022?"
];

export default function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

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
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'bot', errorText: data.error || `Request failed (${res.status})` }]);
      } else {
        setMessages((m) => [...m, { role: 'bot', answer: data }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'bot', errorText: String(err) }]);
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
                        Read source
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
                {m.answer && (
                  <div className={styles.debugLine}>
                    retrieved {m.answer.retrieval_count ?? 0} candidate
                    {m.answer.retrieval_count === 1 ? '' : 's'}
                    {m.answer.retrieved_titles?.length ? `: ${m.answer.retrieved_titles.join('; ')}` : ''}
                  </div>
                )}
              </div>
            )
          )}
          {loading && <div className={styles.debugLine}>Searching the record…</div>}
        </div>

        <div className={styles.suggestionRow}>
          {SUGGESTIONS.map((s) => (
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
      </div>
    </>
  );
}
