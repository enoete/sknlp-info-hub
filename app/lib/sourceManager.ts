import { pool } from './db';
import {
  ADD_SOURCE_TYPE_OPTIONS,
  VALID_SOURCE_TYPES,
  VALID_ADD_SOURCE_TYPES,
  resolveSourceDefaults
} from './sourceManagerShared';

export interface NewSourceInput {
  type: string;        // ADD_SOURCE_TYPE_OPTIONS value — drives defaulting, not stored directly
  sourceType: string;  // SOURCE_TYPE_OPTIONS value -> source_type column
  label: string;
  urlOrHandle: string;
}

export class ValidationError extends Error {}

export async function createSource(input: NewSourceInput): Promise<{ id: string }> {
  const label = input.label?.trim();
  const urlOrHandle = input.urlOrHandle?.trim();

  if (!label) throw new ValidationError('label is required');
  if (!urlOrHandle) throw new ValidationError('URL or handle is required');
  if (!VALID_ADD_SOURCE_TYPES.has(input.type)) throw new ValidationError(`invalid type: ${input.type}`);
  if (!VALID_SOURCE_TYPES.has(input.sourceType)) throw new ValidationError(`invalid classification: ${input.sourceType}`);

  const defaults = resolveSourceDefaults(input.type, urlOrHandle);
  const typeLabel = ADD_SOURCE_TYPE_OPTIONS.find((o) => o.value === input.type)?.label ?? input.type;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sources_registry
       (label, platform, handle_or_url, source_type, tier, detection_method, requires_manual_capture, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      label,
      defaults.platform,
      urlOrHandle,
      input.sourceType,
      defaults.tier,
      defaults.detection_method,
      defaults.requires_manual_capture,
      `Added via Source Manager "Add a source" form — type: ${typeLabel}`
    ]
  );
  return rows[0];
}

export interface RegisteredSource {
  id: string;
  label: string;
  platform: string;
  handle_or_url: string;
  source_type: string;
  tier: string;
  detection_method: string;
  requires_manual_capture: boolean;
  status: string;
  last_checked_at: string | null;
  last_new_item_at: string | null;
  notes: string | null;
}

// Stage 1 of the Source Manager (design-reference/source-manager-mockup.html):
// read-only list only. No add/edit/delete/run actions yet — those come in
// later stages once this read path is confirmed correct.
export async function getRegisteredSources(): Promise<RegisteredSource[]> {
  const { rows } = await pool.query<RegisteredSource>(
    `SELECT
       id, label, platform, handle_or_url, source_type, tier,
       detection_method, requires_manual_capture, status,
       to_char(last_checked_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_checked_at,
       to_char(last_new_item_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_new_item_at,
       notes
     FROM sources_registry
     WHERE deleted_at IS NULL
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
       label ASC`
  );
  return rows;
}
