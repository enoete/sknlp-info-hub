import Link from 'next/link';
import styles from './dashboard.module.css';
import { getDashboardClaims, getDashboardStats } from './lib/claims';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [claims, stats] = await Promise.all([getDashboardClaims(), getDashboardStats()]);

  return (
    <main className="max-w-5xl mx-auto px-9 py-12">
      <div className={styles.topLinks}>
        <Link href="/ask">Ask the Record →</Link>
        <Link href="/source-manager">Source Manager (internal) →</Link>
      </div>

      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Official record</div>
        <h1>WHAT&apos;S ACTUALLY BEEN DONE</h1>
        <p>
          Every entry here links to a press release, a government notice, a speech, or a document
          the party has uploaded. No entry, no claim — filter by year or sector below.
        </p>
      </div>

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.num}>{stats.accomplishments}</div>
          <div className={styles.label}>Documented accomplishments</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.num}>{stats.sourcesIndexed}</div>
          <div className={styles.label}>Source documents indexed</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.num}>{stats.oppositionClaims}</div>
          <div className={styles.label}>Opposition claims cross-checked</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.num}>{stats.yearsLabel}</div>
          <div className={styles.label}>Years covered</div>
        </div>
      </div>

      <DashboardClient claims={claims} />
    </main>
  );
}
