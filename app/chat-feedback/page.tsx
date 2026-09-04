import styles from './chat-feedback.module.css';
import { getChatQueryLog, getMostClickedSuggestions, MOST_CLICKED_LIMIT } from '@/app/lib/chatQueries';
import ChatFeedbackClient from './ChatFeedbackClient';

export const dynamic = 'force-dynamic';

export default async function ChatFeedbackPage() {
  const [log, mostClicked] = await Promise.all([getChatQueryLog(), getMostClickedSuggestions(MOST_CLICKED_LIMIT)]);

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-9 py-8 sm:py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Internal · not public</div>
        <h1>CHAT FEEDBACK</h1>
        <p>
          Every question asked in Ask the Record, logged with no identity or session signal — same
          promise as the chatbot itself. Rate how well each one was actually answered, leave a note
          on what the engine should have searched for, and link or write the correct answer when it
          missed. A rating never changes what a live visitor saw; it only improves future answers.
        </p>
      </div>

      <ChatFeedbackClient initialLog={log} mostClicked={mostClicked} mostClickedLimit={MOST_CLICKED_LIMIT} />
    </main>
  );
}
