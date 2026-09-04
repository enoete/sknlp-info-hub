-- ============================================================
-- SKN Labour Party accomplishment/record platform — core schema
-- Design principle: every public-facing claim traces to a row
-- in `sources` or `proof_documents`. No source_id = not published.
-- Tables are ordered so every foreign key references a table
-- already created above it — run top to bottom, no reordering needed.
-- ============================================================

-- pgvector/pgvector:pg16 ships the extension binary but each database
-- still has to register it explicitly before VECTOR columns/ops work.
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram similarity — used to catch near-duplicate claims.title across
-- overlapping seed batches (real incident: three claims were seeded
-- twice, word-for-word or near-identical, from two seed files covering
-- the same underlying 4P campaign material). Re-run before trusting a
-- new batch of seeded/ingested claims:
--   SELECT a.id, b.id, a.title, b.title, similarity(a.title, b.title)
--   FROM claims a JOIN claims b ON a.id < b.id
--   WHERE similarity(a.title, b.title) > 0.35 ORDER BY 5 DESC;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE source_type AS ENUM ('official_party', 'official_govt', 'opposition', 'press', 'third_party');
CREATE TYPE ingestion_channel AS ENUM ('youtube', 'sknis', 'press_release', 'social_post', 'admin_upload', 'manual_entry');
CREATE TYPE review_status AS ENUM ('pending_review', 'approved', 'rejected', 'needs_edit');
CREATE TYPE claim_stance AS ENUM ('accomplishment', 'opposition_statement');
CREATE TYPE source_tier AS ENUM ('owned', 'third_party');
CREATE TYPE detection_method AS ENUM ('oauth_api', 'push_webhook', 'public_rss', 'manual_capture');
CREATE TYPE registry_status AS ENUM ('active', 'paused', 'needs_legal_review');
CREATE TYPE sample_origin AS ENUM ('initial_enrollment', 'confirmed_correction');
CREATE TYPE attachment_type AS ENUM ('image', 'text', 'video');
CREATE TYPE suggestion_status AS ENUM ('new', 'under_consideration');

-- ------------------------------------------------------------
-- ADMIN USERS: created first — referenced by almost everything
-- below (who added a source, who confirmed a speaker, who
-- approved a claim). No dependencies of its own.
-- ------------------------------------------------------------
CREATE TABLE admin_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('editor','approver','superadmin')),
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- SPEAKERS: known voice-identified individuals, official or
-- opposition. No dependencies of its own.
-- ------------------------------------------------------------
CREATE TABLE speakers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    TEXT NOT NULL,              -- e.g. "Minister of Health" or a named public figure
    org             TEXT,                       -- general affiliation, e.g. "SKNLP", "PAM" — NOT a title.
                                                  -- Titles/roles are volatile (leadership changes, elections);
                                                  -- capture role-at-time-of-statement on transcript_segments
                                                  -- instead, never derive a historical statement's title from
                                                  -- this table's "current" state.
    source_type     source_type NOT NULL,       -- official_party / official_govt / opposition / press
    voiceprint_ref  TEXT,                       -- pointer to the speaker's enrollment record in the speaker-ID
                                                  -- provider (e.g. a pyannoteAI voiceprint id), null until enrolled
    enrolled_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- SOURCES REGISTRY: the list of channels/pages/sites the
-- ingestion agent watches. This is config, not content.
-- ------------------------------------------------------------
CREATE TABLE sources_registry (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label             TEXT NOT NULL,
    platform          TEXT NOT NULL,             -- 'youtube', 'facebook', 'instagram', 'sknis', 'website', 'radio', 'other'
    handle_or_url     TEXT NOT NULL,
    source_type       source_type NOT NULL,
    tier              source_tier NOT NULL,      -- owned = we have API/OAuth access; third_party = public only
    detection_method  detection_method NOT NULL,
    poll_frequency_min INT,                      -- minutes between checks; null if push-based (webhook)
    requires_manual_capture BOOLEAN NOT NULL DEFAULT false,
    status            registry_status NOT NULL DEFAULT 'active',
    last_checked_at   TIMESTAMPTZ,
    last_new_item_at  TIMESTAMPTZ,
    notes             TEXT,
    added_by          UUID REFERENCES admin_users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Soft delete only — a registry row can back-reference real ingested
    -- sources/claims, so a hard DELETE would either cascade into content
    -- that already went public or fail on the FK. Source Manager's delete
    -- action sets this instead of removing the row.
    deleted_at        TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- SOURCES: every scraped or submitted origin document/video/post
-- ------------------------------------------------------------
CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registry_id     UUID REFERENCES sources_registry(id),
    source_type     source_type NOT NULL,
    channel         ingestion_channel NOT NULL,
    title           TEXT NOT NULL,
    speaker_name    TEXT,
    speaker_org     TEXT,
    origin_url      TEXT NOT NULL,
    archived_url    TEXT,
    published_at    TIMESTAMPTZ,
    video_timestamp TEXT,
    raw_transcript  TEXT,
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Lets a search of "Grey-Brookes" or "PAM" surface a claim even when
    -- those words aren't in the claim's own title/summary/category.
    search_vector   TSVECTOR GENERATED ALWAYS AS (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(speaker_name, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(speaker_org, '')), 'B')
                    ) STORED
);

-- ------------------------------------------------------------
-- SOURCE ATTACHMENTS: multi-modal single-post ingestion. One
-- Facebook post can carry a photo, caption text, and a video
-- together — grouped under one `sources` row and extracted as a
-- single combined post, not three disconnected items (Source
-- Manager's "Add a source" form's attachment slots write here).
-- ------------------------------------------------------------
CREATE TABLE source_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    attachment_type attachment_type NOT NULL,
    file_url        TEXT,
    raw_text        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- TRANSCRIPT SEGMENTS: sits between a source and a claim, so a
-- claim can point to the exact moment it was said (timestamped
-- links) and to which speaker said it.
-- ------------------------------------------------------------
CREATE TABLE transcript_segments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    speaker_id      UUID REFERENCES speakers(id),   -- null until identified
    speaker_confidence NUMERIC(4,3),                -- 0.000-1.000, voice match confidence
    speaker_title_at_time TEXT,                     -- e.g. "PAM Leader" — captured at ingestion time, never
                                                      -- overwritten as the person's role changes later
    speaker_name_at_time TEXT,                      -- e.g. "Timothy Harris" — the actual named individual,
                                                      -- distinct from the role/title above (a role can be
                                                      -- shared/reused across administrations, e.g. "Prime
                                                      -- Minister"; the name is what actually lets a viewer
                                                      -- filter "show me everything Mark Brantley said").
                                                      -- Null when the speaker is a caller (never named, see
                                                      -- CLAUDE.md's "Call-in callers" decision) or genuinely
                                                      -- unidentified — never guessed to fill this in.
    start_seconds   INT NOT NULL,
    end_seconds     INT NOT NULL,
    text            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- SPEAKER VOICE SAMPLES: the enrollment set behind speaker
-- identification. Starts with a few confirmed clean clips per
-- known figure; grows every time an admin confirms or corrects a
-- medium-confidence match in the review queue. This growing set
-- is what lets identification improve over time instead of
-- guessing fresh from context on every video.
-- ------------------------------------------------------------
CREATE TABLE speaker_voice_samples (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    speaker_id          UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    audio_clip_url      TEXT NOT NULL,              -- storage ref to the clean clip used for enrollment
    source_segment_id   UUID REFERENCES transcript_segments(id),  -- where this clip came from, if applicable
    origin              sample_origin NOT NULL,      -- initial_enrollment vs confirmed_correction (the "teaching" signal)
    confirmed_by        UUID REFERENCES admin_users(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- PROOF DOCUMENTS: party-supplied evidence (not auto-scraped)
-- ------------------------------------------------------------
CREATE TABLE proof_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_url            TEXT NOT NULL,
    file_type           TEXT NOT NULL,
    title               TEXT NOT NULL,
    document_dated_at   DATE,                       -- date on/implied by the document itself
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),  -- real upload date, never backdated
    uploaded_by         UUID REFERENCES admin_users(id),
    notes               TEXT
);

-- ------------------------------------------------------------
-- DOCUMENT CHUNKS: claim knowledge base — deep supporting
-- documentation per proof document, chunked for retrieval.
-- embedding stays null until a Voyage AI key exists; falls back
-- to full-text search on chunk_text until then, same reasoning
-- as claims.search_vector above.
-- ------------------------------------------------------------
CREATE TABLE document_chunks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proof_document_id   UUID NOT NULL REFERENCES proof_documents(id) ON DELETE CASCADE,
    chunk_text          TEXT NOT NULL,
    chunk_order         INT NOT NULL,
    embedding           VECTOR(1024),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_chunks_claim_lookup ON document_chunks (proof_document_id);

-- ------------------------------------------------------------
-- CLAIMS: the atomic unit — one specific statement, either
-- an accomplishment (official) or an opposition statement
-- ------------------------------------------------------------
CREATE TABLE claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stance          claim_stance NOT NULL,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    category        TEXT,
    sentiment       TEXT CHECK (sentiment IN ('positive','neutral','negative','critical')),
    -- Sub-classification within stance='accomplishment' only (NULL for
    -- opposition_statement claims) -- 'accomplishment' the stance value
    -- had been doing double duty as both "whose side is this claim on"
    -- and "what kind of win is this," which flattened a completed
    -- project, a policy decision, a strategic commitment, and an
    -- in-progress initiative into one identical badge. This is the
    -- honest subtype; stance keeps meaning only "government/party side
    -- vs opposition side" so existing stance-based filtering logic
    -- (Dashboard, Timeline, etc.) is untouched. Written directly by the
    -- ingestion agent (extract_from_video.py's RESPONSE_SCHEMA) same as
    -- category/sentiment -- a bounded classification call, not a
    -- freeform narrative judgment like citizen_impact, so it doesn't need
    -- the *_suggested human-confirmation gate those use.
    accomplishment_type TEXT CHECK (
        accomplishment_type IS NULL OR
        accomplishment_type IN ('Accomplishment','Policy Decision','Strategic Decision','Ongoing Initiative')
    ),
    -- Self-reference on the NEWER claim, pointing back to the earlier
    -- 'Ongoing Initiative' / 'Strategic Decision' / 'Policy Decision' it
    -- fulfills -- e.g. a later "desalination plant completed" claim's
    -- completes_claim_id points at the earlier "groundbreaking held"
    -- claim. Lets the Dashboard/Claim Detail/Ask the Record show the
    -- up-to-date status of an initiative instead of leaving the original
    -- claim looking perpetually unfinished. Manual, admin-linked only via
    -- the review queue (see app/lib/reviewQueue.ts) -- no automatic
    -- similarity matching, same "flag for a human, never auto-resolve"
    -- posture used elsewhere in this schema (see the speaker-identity
    -- disagreement rule in CLAUDE.md). ON DELETE SET NULL rather than
    -- CASCADE: deleting the completing claim should un-link, never take
    -- the earlier claim down with it.
    completes_claim_id UUID REFERENCES claims(id) ON DELETE SET NULL,
    CONSTRAINT claims_completes_not_self CHECK (completes_claim_id IS NULL OR completes_claim_id != id),
    -- Self-reference on an opposition_statement claim, pointing at the
    -- accomplishment claim an admin has manually confirmed IS the
    -- government's own clarification/response to that allegation --
    -- decided 2026-08-31, prompted directly: "what will need to happen
    -- is for the government to add their own clarifications manually
    -- but that will need to be tagged as a manual entry... clarified by
    -- admin." Deliberately NOT a free-text field: an admin can only link
    -- to an EXISTING approved accomplishment claim (same
    -- search-and-pick UI, searchAccomplishmentClaims(), as
    -- completes_claim_id above), never type an unsourced clarification
    -- directly -- that would violate this project's own non-negotiable
    -- "every public claim must trace to a real source" rule. If the
    -- real clarification doesn't exist as a claim yet, the government
    -- statement has to be ingested as its own sourced accomplishment
    -- claim first, then linked here. Same "flag for a human, never
    -- auto-resolve" posture as completes_claim_id, and takes priority
    -- over findClosestRecord()'s automated same-category match when
    -- both exist (oppositionWatch.ts, retrieve.ts) -- an admin's
    -- explicit judgment should always win over a heuristic. Rendered as
    -- a distinct "Clarified by admin" tag, never merged visually with
    -- the auto-matched "Clarified" pill, so a reader can tell the two
    -- apart.
    manual_clarification_id UUID REFERENCES claims(id) ON DELETE SET NULL,
    CONSTRAINT claims_clarification_not_self CHECK (manual_clarification_id IS NULL OR manual_clarification_id != id),
    -- Second, lighter-weight clarification path -- decided 2026-09-01,
    -- prompted directly: the search-and-pick above only works when the
    -- clarification already exists as its own ingested claim, and "if
    -- your LLM could not find a cogent match, I dont think a human
    -- would" either, via a keyword search over existing claim titles.
    -- Most real clarifications won't already be sitting in the corpus
    -- as their own claim. This lets an admin write the clarification
    -- directly -- title, body text, and a source URL -- without first
    -- having to get it ingested as a full claim. Still never bare
    -- unsourced text: manual_clarification_url is the citation,
    -- required alongside the other two at the application layer (see
    -- reviewQueue.ts's updateManualClarificationText). Mutually
    -- exclusive with manual_clarification_id above -- setting one
    -- clears the other, so there's never ambiguity about which
    -- clarification is the real one.
    manual_clarification_title TEXT,
    manual_clarification_text TEXT,
    manual_clarification_url TEXT,
    -- Only ever set via explicit human confirmation/edit — including
    -- confirming event_date_suggested below via the review queue's planned
    -- "confirm suggested date" card (see CLAUDE.md). Never written directly
    -- by the ingestion agent, same discipline as citizen_impact.
    event_date      DATE,
    -- The ingestion agent's draft of the above (extract_from_video.py,
    -- RESPONSE_SCHEMA.event_date_suggested) — an ISO date parsed from an
    -- explicit statement in the video, never inferred from upload date.
    -- Never copied into event_date automatically.
    event_date_suggested DATE,
    -- No stored `year` column — it was a separately-authored copy of
    -- event_date's year that drifted out of sync in practice (several
    -- write paths set event_date but never touched year, so real dated
    -- claims silently vanished from year-based stats/filters). Derive it
    -- at query time instead: EXTRACT(YEAR FROM event_date). See
    -- idx_claims_event_date_category below for the index this replaces.
    -- Full-text search (no Voyage AI/embeddings key yet — this is the real
    -- retrieval path for "Ask the Record" until embedding-based similarity
    -- search replaces it). 'english' config is written explicitly (not
    -- left to the default_text_search_config GUC) because that's what
    -- makes to_tsvector() IMMUTABLE and therefore legal in a generated column.
    search_vector   TSVECTOR GENERATED ALWAYS AS (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
                        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
                    ) STORED,
    extracted_by    TEXT NOT NULL DEFAULT 'llm_agent',  -- 'llm_agent', 'gemini_agent', or 'manual'
    extraction_confidence TEXT,                      -- 'high' / 'medium' / 'low', set by the ingestion agent; null for manual entries
    -- Plain-language "what this means for you", shown publicly on the
    -- Dashboard. Only ever set via explicit human authorship or a human
    -- promoting citizen_impact_suggested below — never written directly
    -- by the ingestion agent. NULL means it still needs a human/deliberate
    -- pass, not that it was skipped by design.
    citizen_impact  TEXT,
    -- The ingestion agent's draft of the above (extract_from_video.py,
    -- RESPONSE_SCHEMA.citizen_impact_suggested). Never rendered publicly
    -- and never copied into citizen_impact automatically — a human in the
    -- review queue reads this, edits it if needed, and explicitly promotes
    -- it. Keeping this as a separate column (rather than writing straight
    -- to citizen_impact) is what makes "never auto-generated" enforceable
    -- instead of just a comment nobody notices at the call site.
    citizen_impact_suggested TEXT,
    -- Distinct from review_status -- an approved claim is real, verified,
    -- and citable, but not every real claim belongs in the curated
    -- public browsing experience (Dashboard/Timeline). Decided
    -- 2026-08-31 after a concrete example: a "Safe Rescue of All
    -- Passengers and Crew from Apple Syder Ferry Incident" claim is a
    -- genuine, sourced fact, but it's an isolated incident, not a
    -- government policy/decision/initiative -- exactly the kind of
    -- "noise" that would overwhelm the curated views if the volume of
    -- ingestion keeps growing, per the client's own words: "if it's too
    -- much data, it will become overwhelming and people won't want to
    -- use it." featured=false claims stay fully approved and fully
    -- searchable by Ask the Record (retrieve.ts does NOT filter on this
    -- column, deliberately -- "some of the stuff can be used to answer
    -- chatbot-related questions") -- they're just excluded from
    -- getDashboardClaims()/getTimelineClaims()'s curated grids. Defaults
    -- true (most real accomplishment/opposition claims belong on the
    -- public views); the ingestion agent can propose false directly
    -- (see extract_from_video.py's RESPONSE_SCHEMA.featured, a bounded
    -- classification call like category/accomplishment_type, not a
    -- *_suggested human-confirmation field), and it's editable after
    -- the fact in the review queue, same pattern as accomplishment_type.
    featured        BOOLEAN NOT NULL DEFAULT true,
    review_status   review_status NOT NULL DEFAULT 'pending_review',
    reviewed_by     UUID REFERENCES admin_users(id),
    reviewed_at     TIMESTAMPTZ,
    embedding       VECTOR(1536),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many join tables (all referenced tables now exist above)
CREATE TABLE claim_sources (
    claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    source_id   UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (claim_id, source_id)
);

CREATE TABLE claim_proof_documents (
    claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    proof_id    UUID NOT NULL REFERENCES proof_documents(id) ON DELETE CASCADE,
    PRIMARY KEY (claim_id, proof_id)
);

CREATE TABLE claim_transcript_segments (
    claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    segment_id  UUID NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
    PRIMARY KEY (claim_id, segment_id)
);

-- ------------------------------------------------------------
-- AUDIT LOG
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    UUID REFERENCES admin_users(id),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   UUID NOT NULL,
    diff        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- CHAT QUERIES: every question asked through "Ask the Record",
-- for the "most-asked questions" starting-suggestion source
-- (app/lib/suggestions.ts) and future admin visibility into what
-- people are actually asking. Deliberately carries NO IP address,
-- session id, user agent, or any other identity/device signal —
-- this is a content log, not a tracking log (same promise already
-- made for public "Suggest a Priority" submissions). The privacy
-- line in the Ask the Record UI depends on this staying true; if a
-- future column is ever added here, re-check that promise before
-- adding it, don't assume it still holds.
-- ------------------------------------------------------------
CREATE TABLE chat_queries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question    TEXT NOT NULL,
    found       BOOLEAN NOT NULL,
    claim_id    UUID REFERENCES claims(id),  -- the claim actually cited back; null when found=false
    -- True when this question was asked by clicking a pre-filled
    -- suggestion pill (a starting suggestion or a follow-up) rather than
    -- typed by hand — lets the admin feedback log below show which
    -- suggestions actually get used. Set by the client (ChatClient.tsx),
    -- not inferred server-side.
    is_suggestion BOOLEAN NOT NULL DEFAULT false,
    -- ------------------------------------------------------------
    -- ADMIN ANSWER-QUALITY FEEDBACK LOOP (decided 2026-09-04). See
    -- CLAUDE.md's "Chatbot answer-quality feedback loop" section and
    -- app/chat-feedback/. None of this is populated by a citizen or
    -- collected automatically — every column below stays NULL until an
    -- admin reviews the row by hand (feedback_reviewed_at IS NULL means
    -- "not yet reviewed"), so it doesn't touch the no-identity-signal
    -- promise made above: this is an admin's own judgment about an
    -- already-anonymous question, not new data collected about the
    -- person who asked it.
    -- ------------------------------------------------------------
    feedback_rating            TEXT CHECK (feedback_rating IN ('not_answered', 'partially_answered', 'fully_answered')),
    -- Admin's free-text note on what the engine should have searched for
    -- instead — fed back into retrieval for a future similarly-worded
    -- question via getAdminSearchHint() in app/lib/chatQueries.ts, not
    -- just stored for record-keeping.
    feedback_context            TEXT,
    -- The actually-correct claim, if an admin found one via search.
    -- Mutually exclusive with feedback_correction_* below — same
    -- linked-claim-vs-written-text posture as claims.manual_clarification_id
    -- vs. manual_clarification_title/_text/_url, and for the same reason
    -- (a real past match often doesn't exist as its own ingested claim).
    feedback_claim_id           UUID REFERENCES claims(id),
    feedback_correction_title   TEXT,
    feedback_correction_text    TEXT,
    feedback_correction_url     TEXT,  -- required whenever _title/_text are set — never store an unsourced correction
    feedback_reviewed_at        TIMESTAMPTZ,
    feedback_reviewed_by        TEXT,  -- free-text admin name, same maturity level as suggestion_acknowledgements.acknowledged_by — no real admin auth yet
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches the exact "most-asked, found=true" query in suggestions.ts.
CREATE INDEX idx_chat_queries_found_question ON chat_queries (question) WHERE found = true;
-- Backs getMostClickedSuggestions()'s "which pre-filled questions get
-- clicked most" admin panel.
CREATE INDEX idx_chat_queries_suggestion_question ON chat_queries (question) WHERE is_suggestion = true;
-- Backs getAdminSearchHint()'s pg_trgm similarity lookup (pg_trgm is
-- already ✅ Migrated live, see CLAUDE.md's schema status table).
CREATE INDEX idx_chat_queries_question_trgm ON chat_queries USING gin (question gin_trgm_ops);

-- ------------------------------------------------------------
-- SUGGEST A PRIORITY: anonymous public suggestion box + admin
-- review workflow (decided 2026-08-31). See
-- design-reference/source-manager-mockup.html for the pixel spec
-- (public submit form + admin "Trending Suggestions" panel) and
-- CLAUDE.md's "Suggest a Priority" section for the workflow
-- decision. No IP address, session id, or any other identity/
-- device signal is ever stored here — same explicit anonymity
-- promise already made for chat_queries above; if a future column
-- is ever added here, re-check that promise first, don't assume
-- it still holds.
--
-- Two tables, not one: citizen_suggestions is the raw anonymous
-- text as submitted (never edited); suggestion_themes is the
-- clustered concept several submissions can share ("Better public
-- transport"), computed live at submission time via a cheap
-- pg_trgm pre-filter + one LLM same-theme judgment — the identical
-- two-stage pattern already proven for claim de-duplication this
-- session (see ingestion/claim_dedup.py's module docstring), reused
-- here because the failure mode is the same: text similarity alone
-- isn't reliable enough to cluster on by itself.
-- ------------------------------------------------------------
CREATE TABLE suggestion_themes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label       TEXT NOT NULL,      -- short theme name, e.g. "Better public transport" — set from the first submission that started this theme, never edited by a later one
    category    TEXT,               -- one of CATEGORIES (ingestion/extract_from_video.py) — "Other" is a real value, not a stand-in for null
    status      suggestion_status NOT NULL DEFAULT 'new',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE citizen_suggestions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text         TEXT NOT NULL,
    category     TEXT,              -- assigned to THIS submission at intake; usually matches its theme's category but judged independently
    theme_id     UUID REFERENCES suggestion_themes(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, same posture as audit_log — an official's acknowledgement
-- is a real, attributable administrative action worth a durable trail,
-- not a field that gets silently overwritten by the next official who
-- looks at the same theme. A theme can accumulate more than one over
-- time (a follow-up comment as work progresses).
CREATE TABLE suggestion_acknowledgements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id      UUID NOT NULL REFERENCES suggestion_themes(id),
    official_name TEXT NOT NULL,
    comment       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_citizen_suggestions_theme ON citizen_suggestions (theme_id);
CREATE INDEX idx_suggestion_themes_status ON suggestion_themes (status);
CREATE INDEX idx_suggestion_acknowledgements_theme ON suggestion_acknowledgements (theme_id);

-- ------------------------------------------------------------
-- CALENDAR (separate, simple)
-- ------------------------------------------------------------
CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ,
    location    TEXT,
    description TEXT,
    source_id   UUID REFERENCES sources(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
CREATE INDEX idx_claims_event_date_category ON claims (event_date, category) WHERE review_status = 'approved';
CREATE INDEX idx_claims_stance ON claims (stance) WHERE review_status = 'approved';
CREATE INDEX idx_claims_embedding ON claims USING ivfflat (embedding vector_cosine_ops) WHERE review_status = 'approved';
CREATE INDEX idx_claims_search_vector ON claims USING GIN (search_vector);
CREATE INDEX idx_sources_search_vector ON sources USING GIN (search_vector);
CREATE INDEX idx_registry_active ON sources_registry (tier, status) WHERE status = 'active';
CREATE INDEX idx_segments_source ON transcript_segments (source_id);
CREATE INDEX idx_segments_unresolved_speaker ON transcript_segments (id) WHERE speaker_id IS NULL;
CREATE INDEX idx_voice_samples_speaker ON speaker_voice_samples (speaker_id);

-- ------------------------------------------------------------
-- SCOPE WINDOW: this administration's term only.
-- Inaugurated August 5, 2022. Prior "Unity" administration
-- (2015-2022) and earlier SKNLP eras are explicitly out of scope
-- for now — do not backfill without a separate decision to do so.
-- Enforce as an app-level config constant the ingestion agent
-- checks against, not a rigid DB constraint (scope may expand later).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- SPEAKER IDENTIFICATION: enrollment + active learning loop
-- 1. Enroll each known figure from a few clean confirmed clips
--    (speaker_voice_samples, origin='initial_enrollment') via the
--    speaker-ID provider (e.g. pyannoteAI /v1/voiceprint), store
--    the returned reference in speakers.voiceprint_ref.
-- 2. On new segments, match against enrolled voiceprints. High
--    confidence -> auto-assign speaker_id. Medium -> surface in
--    the review queue as "confirm this speaker?" with a short
--    clip. Low/no match -> leave speaker_id null, flagged unknown.
-- 3. Every confirmed/corrected medium-confidence match gets added
--    as a new speaker_voice_samples row (origin='confirmed_correction'),
--    growing the enrollment set and improving future matches.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Seed rows for sources_registry, based on actual confirmed channels.
-- Uncomment and run after creating the schema.
-- ------------------------------------------------------------
-- INSERT INTO sources_registry (label, platform, handle_or_url, source_type, tier, detection_method, poll_frequency_min, requires_manual_capture, status, notes) VALUES
-- ('SKNLP official YouTube', 'youtube', '@StKittsNevisLabourParty', 'official_party', 'owned', 'push_webhook', NULL, false, 'active', 'OAuth connected, official captions API'),
-- ('SKNIS official YouTube', 'youtube', '@SKNISmedia', 'official_govt', 'owned', 'push_webhook', NULL, false, 'active', 'Government information service — NOT opposition, same tier as sknis.gov.kn'),
-- ('SKNIS press releases', 'sknis', 'https://www.sknis.gov.kn', 'official_govt', 'owned', 'public_rss', 15, false, 'active', 'Sitemap/RSS polled every 15 min'),
-- ('SKNLP official website', 'website', 'https://sknlabourparty.com', 'official_party', 'owned', 'public_rss', 30, false, 'active', 'Party''s own site, likely has press releases; confirm feed availability'),
-- ('PAM official YouTube', 'youtube', '@pamsknofficial4503', 'opposition', 'third_party', 'public_rss', 60, false, 'active', 'Public channel, no auth needed; posts infrequently — low volume expected'),
-- ('WINN FM news site', 'website', 'https://www.winnmediaskn.com', 'press', 'third_party', 'public_rss', 60, false, 'active', 'WordPress; has Local News + Press Release categories; confirm /feed/ works'),
-- ('WINN FM YouTube (talk shows)', 'youtube', 'channel/UCENebMHKAAEYEQ-AXNrfbIw', 'press', 'third_party', 'public_rss', 120, false, 'active', 'Hosts ISLAND TEA, VOICES, INSIDE THE NEWS — has featured opposition figures directly'),
-- ('Freedom FM news site', 'website', 'https://freedomfm1065.com/news', 'press', 'third_party', 'public_rss', 60, false, 'active', 'WordPress; existing tag pages for PAM, People''s Action Movement, Natasha Grey-Brookes — taxonomy already aligns well'),
-- ('Freedom FM YouTube', 'youtube', '@FreedomFM106.5', 'press', 'third_party', 'public_rss', 120, false, 'active', 'Confirm channel activity level before relying on it'),
-- ('ZIZ news', 'website', 'https://zizonline.com', 'press', 'third_party', 'manual_capture', NULL, true, 'paused', 'Site currently offline (as of Aug 2026) — do not build automation against this until it''s confirmed back up. Government-aligned outlet when active; never treat as independent confirmation in Opposition Watch comparisons.'),
-- ('Opposition figures — Facebook (manual)', 'facebook', 'n/a — manual only', 'opposition', 'third_party', 'manual_capture', NULL, true, 'active', 'Timothy Harris, Shawn Richards, Mark Brantley, Natasha Grey-Brookes — Meta Graph API review not pursued; comms team uploads clips/screenshots directly');
