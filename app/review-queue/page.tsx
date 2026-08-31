import styles from './review-queue.module.css';
import { getPendingClaims } from '@/app/lib/reviewQueue';
import ReviewQueueClient from './ReviewQueueClient';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const claims = await getPendingClaims();

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Internal · not public</div>
        <h1>REVIEW QUEUE</h1>
        <p>
          Nothing extracted reaches the public archive until someone approves it here. Minimal
          version: approve/reject only — no edit affordance yet.
        </p>
      </div>

      <ReviewQueueClient claims={claims} />
    </main>
  );
}
