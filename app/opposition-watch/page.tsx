import styles from './opposition-watch.module.css';
import { getOppositionPairs } from '@/app/lib/oppositionWatch';
import OppositionWatchClient from './OppositionWatchClient';

export const dynamic = 'force-dynamic';

export default async function OppositionWatchPage() {
  const pairs = await getOppositionPairs();

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Opposition watch</div>
        <h1>CLAIM, MEET RECORD</h1>
        <p>
          Statements made publicly against the party, shown next to the closest matching documented
          record. No verdicts — just both, side by side, sourced.
        </p>
      </div>

      <OppositionWatchClient pairs={pairs} />
    </main>
  );
}
