import Link from 'next/link';
import styles from '../source-manager.module.css';
import { getSuggestionThemes } from '@/app/lib/citizenSuggestions';
import TrendingSuggestionsClient from './TrendingSuggestionsClient';

export const dynamic = 'force-dynamic';

export default async function TrendingSuggestionsPage() {
  const themes = await getSuggestionThemes();
  const newCount = themes.filter((t) => t.status === 'new').length;

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Internal · admin only</div>
        <h1>TRENDING SUGGESTIONS</h1>
        <p>
          AI-clustered themes from public submissions at <Link href="/suggest">/suggest</Link>, ranked by how
          often each comes up. Same &ldquo;here&apos;s the signal, you decide what to do&rdquo; framing as the
          opposition-volume view — acknowledging a theme logs an official response for the record, it doesn&apos;t
          promise or commit to anything.
        </p>
      </div>

      <div className={styles.stageNote}>
        {themes.length} theme{themes.length === 1 ? '' : 's'} from {themes.reduce((s, t) => s + t.mention_count, 0)}{' '}
        total submission{themes.reduce((s, t) => s + t.mention_count, 0) === 1 ? '' : 's'} · {newCount} awaiting a
        first response. Clustering runs live per submission (pg_trgm pre-filter + one LLM same-theme judgment), not
        a periodic batch job.
      </div>

      <TrendingSuggestionsClient themes={themes} />
    </main>
  );
}
