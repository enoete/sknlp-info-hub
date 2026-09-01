import styles from './suggest.module.css';
import SuggestForm from './SuggestForm';

export const dynamic = 'force-dynamic';

export default function SuggestPage() {
  return (
    <main className="max-w-2xl mx-auto px-9 py-12">
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Suggest a priority</div>
        <h1>WHAT SHOULD WE FOCUS ON NEXT?</h1>
        <p>Tell the party what you want to see next — no login, no name attached.</p>
      </div>

      <SuggestForm />
    </main>
  );
}
