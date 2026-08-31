'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './source-manager.module.css';
import Combobox from '@/app/components/Combobox';
import {
  ADD_SOURCE_TYPE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  CONTENT_FIELD_CONFIG
} from '@/app/lib/sourceManagerShared';

export default function AddSourceForm({ existingLabels }: { existingLabels: string[] }) {
  const router = useRouter();
  const [type, setType] = useState(ADD_SOURCE_TYPE_OPTIONS[0].value);
  const [sourceType, setSourceType] = useState(SOURCE_TYPE_OPTIONS[0].value);
  const [label, setLabel] = useState('');
  const [urlOrHandle, setUrlOrHandle] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const field = CONTENT_FIELD_CONFIG[type];
  const labelOptions = useMemo(() => existingLabels.map((l) => ({ value: l, label: l })), [existingLabels]);

  function handleTypeChange(next: string) {
    setType(next);
    // Field semantics change per type (a URL isn't the same thing as
    // pasted text) — don't carry stale content across the switch.
    setUrlOrHandle('');
    setFileName('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Stage 2 only writes sources_registry — no source_attachments/file
    // storage yet, so the actual file is never uploaded here, only its
    // name is recorded as a placeholder for the real value.
    setFileName(file?.name ?? '');
    setUrlOrHandle(file?.name ?? '');
  }

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
        setFileName('');
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
          <Combobox
            id="type"
            mode="strict"
            options={ADD_SOURCE_TYPE_OPTIONS}
            value={type}
            onChange={handleTypeChange}
          />
        </div>
        <div>
          <label className={styles.formLabel} htmlFor="sourceType">Classification</label>
          <Combobox
            id="sourceType"
            mode="strict"
            options={SOURCE_TYPE_OPTIONS}
            value={sourceType}
            onChange={setSourceType}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div>
          <label className={styles.formLabel} htmlFor="label">Label</label>
          <Combobox
            id="label"
            mode="free-text"
            options={labelOptions}
            value={label}
            onChange={setLabel}
            placeholder="e.g. SKNLP official YouTube"
          />
        </div>
        <div>
          <label className={styles.formLabel} htmlFor="content">{field.label}</label>
          {field.kind === 'textarea' ? (
            <textarea
              id="content"
              className={styles.textInput}
              placeholder={field.placeholder}
              value={urlOrHandle}
              onChange={(e) => setUrlOrHandle(e.target.value)}
              rows={3}
            />
          ) : field.kind === 'file' ? (
            <>
              <input id="content" type="file" className={styles.textInput} onChange={handleFileChange} />
              <div className={styles.fieldHint}>
                {fileName
                  ? `Selected: ${fileName} — not uploaded/stored yet, only the filename is recorded in this stage.`
                  : 'Not uploaded/stored yet — only the filename is recorded in this stage.'}
              </div>
            </>
          ) : (
            <input
              id="content"
              className={styles.textInput}
              placeholder={field.placeholder}
              value={urlOrHandle}
              onChange={(e) => setUrlOrHandle(e.target.value)}
            />
          )}
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
