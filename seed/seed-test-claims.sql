-- Seeds the same 6 fixtures that used to live in app/data/test-claims.ts,
-- now as real claims/sources/claim_sources rows, so the DB-backed FTS
-- retrieval path can be verified against known data before real content
-- is ingested. Fake but realistic sources — origin_urls are placeholders.
--
-- Run with: docker exec -i sknlp-info-hub-db-1 psql -U sknlp_app -d sknlp_info_hub -v ON_ERROR_STOP=1 < seed/seed-test-claims.sql
--
-- Safe to re-run against an empty claims table; NOT idempotent against a
-- non-empty one (will just add duplicates) — this is a one-time seed, not
-- a migration.

BEGIN;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('official_govt', 'sknis', 'Budget Address 2023 — Ministry of Finance', NULL,
          'SKN Information Service (SKNIS)', 'https://sknis.gov.kn/budget-address-2023-placeholder', '2023-04-15')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('accomplishment', 'Minimum wage increased EC$360 → EC$500/week',
          'Formal policy change announced in the national budget address, effective under the current administration.',
          'Economy', '2023-04-15', 2023, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('official_party', 'youtube', 'PM breaks ground on new desalination facility', NULL,
          'St. Kitts-Nevis Labour Party (YouTube)', 'https://youtube.com/watch?v=placeholder-desal-groundbreaking', '2024-02-10')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('accomplishment', 'Groundbreaking for new Basseterre desalination plant',
          'Prime Minister broke ground on a new desalination facility intended to expand the water supply for Basseterre and surrounding areas.',
          'Water', '2024-02-10', 2024, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('press', 'press_release', 'Government confirms hospital site review underway', NULL,
          'WINN FM', 'https://winnmediaskn.com/local-news/hospital-site-review-placeholder', '2023-10-05')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('accomplishment', 'JNF General Hospital redevelopment enters site-selection phase',
          'Government confirmed the hospital redevelopment project is in the site-review/determination phase. No record yet of a construction start date.',
          'Healthcare', '2023-10-05', 2023, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('official_govt', 'sknis', 'Commissioner of Police year-end crime statistics briefing', NULL,
          'SKN Information Service (SKNIS)', 'https://sknis.gov.kn/crime-stats-2023-placeholder', '2024-01-15')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('accomplishment', 'Reduction in homicide rate reported for 2023',
          'Year-end crime statistics released showing a reported decline in homicides compared to the prior year.',
          'Security', '2024-01-15', 2024, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('opposition', 'youtube', 'Grey-Brookes press conference on public safety', 'Natasha Grey-Brookes',
          'PAM (People''s Action Movement)', 'https://youtube.com/watch?v=placeholder-pam-presser-crime', '2024-06-01')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('opposition_statement', 'PAM leader says crime has ''doubled'' since 2022',
          'At a press conference, the PAM leader stated crime has doubled since the current administration took office.',
          'Security', '2024-06-01', 2024, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

WITH s AS (
  INSERT INTO sources (source_type, channel, title, speaker_name, speaker_org, origin_url, published_at)
  VALUES ('press', 'press_release', 'Harris addresses supporters on cost of living', 'Timothy Harris',
          'Freedom FM', 'https://freedomfm1065.com/news/harris-cost-of-living-placeholder', '2023-05-20')
  RETURNING id
), c AS (
  INSERT INTO claims (stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
  VALUES ('opposition_statement', 'Harris claims minimum wage increase was ''promised but never delivered''',
          'Timothy Harris told supporters the promised minimum wage increase had not actually been delivered.',
          'Economy', '2023-05-20', 2023, 'manual', NULL, 'approved')
  RETURNING id
)
INSERT INTO claim_sources (claim_id, source_id) SELECT c.id, s.id FROM c, s;

COMMIT;
