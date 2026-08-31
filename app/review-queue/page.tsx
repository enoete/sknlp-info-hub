import styles from './review-queue.module.css';
import { getReviewQueueClaims } from '@/app/lib/reviewQueue';
import ReviewQueueClient from './ReviewQueueClient';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const claims = await getReviewQueueClaims();

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Internal · not public</div>
        <h1>REVIEW QUEUE</h1>
        <p>
          Nothing extracted reaches the public archive until someone approves it here. Approved
          claims can be unapproved — a full retraction, not a soft toggle: it disappears from
          every public surface immediately and its published fields are cleared, not left behind.
        </p>
      </div>

      <ReviewQueueClient claims={claims} />
    </main>
  );
}
