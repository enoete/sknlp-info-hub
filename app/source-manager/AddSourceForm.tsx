'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './source-manager.module.css';
import { ADD_SOURCE_TYPE_OPTIONS, SOURCE_TYPE_OPTIONS } from '@/app/lib/sourceManagerShared';

export default function AddSourceForm() {
  const router = useRouter();
  const [type, setType] = useState(ADD_SOURCE_TYPE_OPTIONS[0].value);
  const [sourceType, setSourceType] = useState(SOURCE_TYPE_OPTIONS[0].value);
  const [label, setLabel] = useState('');
  const [urlOrHandle, setUrlOrHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/source-manager/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, sourceType, label, urlOrHandle })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error || `Save failed (${res.status})` });
      } else {
        setMessage({ kind: 'ok', text: `Saved "${label}".` });
        setLabel('');
        setUrlOrHandle('');
        router.refresh();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={handleSave}>
      <h2 className={styles.sectionLabel}>Add a source</h2>

      <div className={styles.row}>
        <div>
          <label className={styles.formLabel} htmlFor="type">Type</label>
          <select id="type" className={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
            {ADD_SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.formLabel} htmlFor="sourceType">Classification</label>
          <select
            id="sourceType"
            className={styles.select}
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.row}>
        <div>
          <label className={styles.formLabel} htmlFor="label">Label</label>
          <input
            id="label"
            className={styles.textInput}
            placeholder="e.g. SKNLP official YouTube"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.formLabel} htmlFor="urlOrHandle">URL or handle</label>
          <input
            id="urlOrHandle"
            className={styles.textInput}
            placeholder="https://www.youtube.com/@example"
            value={urlOrHandle}
            onChange={(e) => setUrlOrHandle(e.target.value)}
          />
        </div>
      </div>

      {message && (
        <div className={message.kind === 'ok' ? styles.formSuccess : styles.formError}>{message.text}</div>
      )}

      <div className={styles.formActions}>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
