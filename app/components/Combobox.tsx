'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './combobox.module.css';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  id: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /**
   * 'strict': must pick from options — typing filters, but Enter/blur with
   * no matching highlighted option reverts to the last committed value.
   * 'free-text': behaves like strict while the list is open, but Enter/blur
   * on typed text with no match confirms that typed text as a brand-new
   * value instead of rejecting it. Once a value is confirmed it renders as
   * a pill with a × that clears back to an open, editable search state.
   */
  mode: 'strict' | 'free-text';
  placeholder?: string;
}

function labelFor(options: ComboboxOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

// Generic ARIA combobox (WAI-ARIA "Combobox With List Autocomplete" pattern),
// not wired to any particular domain — the Source Manager form is the first
// caller, not the only intended one (e.g. Dashboard filters could reuse this
// if they ever outgrow a handful of pill buttons).
export default function Combobox({ id, options, value, onChange, mode, placeholder }: ComboboxProps) {
  const isFreeText = mode === 'free-text';
  const [query, setQuery] = useState(() => labelFor(options, value));
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [isPill, setIsPill] = useState(isFreeText && value !== '');

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  // Refs mirroring state so the document-level click-outside listener (set
  // up once on mount, not re-subscribed on every keystroke) always reads
  // the latest values instead of a stale closure.
  const isOpenRef = useRef(isOpen);
  const queryRef = useRef(query);
  const valueRef = useRef(value);
  isOpenRef.current = isOpen;
  queryRef.current = query;
  valueRef.current = value;

  // Sync local text/pill state when the value prop changes from outside
  // (e.g. a parent form reset).
  useEffect(() => {
    setQuery(labelFor(options, value));
    if (isFreeText) setIsPill(value !== '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!isOpenRef.current) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHighlighted(-1);
        if (isFreeText) {
          const trimmed = queryRef.current.trim();
          if (trimmed) {
            commit(trimmed);
          } else {
            setQuery('');
          }
        } else {
          setQuery(labelFor(options, valueRef.current));
        }
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // Re-subscribes whenever options/onChange change identity (e.g. a
    // parent re-render after existingLabels grows) so this never reverts
    // using a stale options list — isOpen/query/value themselves are read
    // from refs above precisely so this doesn't ALSO need to re-subscribe
    // on every keystroke.
  }, [isFreeText, options, onChange]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  function openList() {
    setIsOpen(true);
    setHighlighted(-1);
  }

  function commit(raw: string) {
    const matched = options.find((o) => o.value === raw || o.label === raw);
    const finalValue = matched ? matched.value : raw;
    onChange(finalValue);
    setQuery(matched ? matched.label : raw);
    setIsOpen(false);
    setHighlighted(-1);
    if (isFreeText) setIsPill(true);
  }

  function handleClear() {
    onChange('');
    setQuery('');
    setIsPill(false);
    setIsOpen(true);
    setHighlighted(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return; // let Enter fall through to normal form submission when closed
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (filtered.length === 0 ? -1 : (h + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (filtered.length === 0 ? -1 : h <= 0 ? filtered.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        commit(filtered[highlighted].value);
      } else if (isFreeText && query.trim()) {
        commit(query.trim());
      } else if (!isFreeText) {
        setQuery(labelFor(options, value));
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setHighlighted(-1);
      if (isFreeText) {
        if (value) {
          setQuery(labelFor(options, value));
          setIsPill(true);
        } else {
          setQuery('');
        }
      } else {
        setQuery(labelFor(options, value));
      }
    }
  }

  const activeOptionId = highlighted >= 0 && filtered[highlighted] ? `${listboxId}-opt-${highlighted}` : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      {isFreeText && isPill ? (
        <div className={styles.pillField}>
          <span className={styles.pillText}>{query}</span>
          <button type="button" className={styles.pillClear} onClick={handleClear} aria-label={`Clear ${query}`}>
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={activeOptionId}
            className={styles.input}
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              openList();
            }}
            onFocus={() => {
              // Clear the filter text on open so the full option list is
              // immediately browsable via arrow keys, not pre-filtered down
              // to just the currently committed value (which is all that'd
              // match if `query` were left as the committed label — that
              // was the actual bug here: a native text-selection alone
              // doesn't touch the controlled `query` state driving `filtered`).
              setQuery('');
              openList();
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          {isOpen && (
            <ul role="listbox" id={listboxId} className={styles.listbox}>
              {filtered.length === 0 ? (
                <li className={styles.emptyOption}>
                  {isFreeText ? 'Press Enter to add as a new label' : 'No matches'}
                </li>
              ) : (
                filtered.map((o, i) => (
                  <li
                    key={o.value}
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    className={`${styles.option} ${i === highlighted ? styles.optionHighlighted : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(o.value);
                    }}
                    onMouseEnter={() => setHighlighted(i)}
                  >
                    {o.label}
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
