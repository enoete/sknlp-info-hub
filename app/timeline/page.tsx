import styles from './timeline.module.css';
import { getTimelineClaims } from '@/app/lib/claims';
import TimelineClient from './TimelineClient';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const claims = await getTimelineClaims();

  return (
    <main className="max-w-4xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Official record</div>
        <h1>THE RECORD, IN ORDER</h1>
        <p>
          Every documented action, decision, and initiative from this administration, laid out by the date it
          actually happened. Click anything for the full citation trail.
        </p>
      </div>

      <TimelineClient claims={claims} />
    </main>
  );
}
