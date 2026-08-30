import { pool } from './db';

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
