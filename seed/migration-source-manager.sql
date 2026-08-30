-- ============================================================
-- Migration: Source Manager schema additions
-- Safe to run against the live database — additive only, no
-- data loss, no existing table structure changed.
-- ============================================================

-- Soft-delete support on sources_registry — see schema.sql comment
-- for why this is never a hard delete.
ALTER TABLE sources_registry ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Multi-modal single-post ingestion (image + text + video grouped
-- under one source, extracted together).
DO $$ BEGIN
    CREATE TYPE attachment_type AS ENUM ('image', 'text', 'video');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS source_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    attachment_type attachment_type NOT NULL,
    file_url        TEXT,
    raw_text        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim knowledge base — deep supporting documentation per claim,
-- chunked for retrieval. embedding stays null until Voyage AI key
-- exists; falls back to full-text search on chunk_text until then.
CREATE TABLE IF NOT EXISTS document_chunks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proof_document_id   UUID NOT NULL REFERENCES proof_documents(id) ON DELETE CASCADE,
    chunk_text          TEXT NOT NULL,
    chunk_order         INT NOT NULL,
    embedding           VECTOR(1024),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_claim_lookup ON document_chunks (proof_document_id);
