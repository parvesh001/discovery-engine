-- Up Migration

-- Sibling to search_logs, but for ingestion-time model calls (extraction, embedding),
-- which search_logs never sees since it's search-time only (spec 09, Phase 8).
CREATE TABLE ingestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  extraction_model TEXT NOT NULL,
  extraction_input_tokens INT,
  extraction_output_tokens INT,
  embedding_model TEXT NOT NULL,
  embedding_tokens INT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS ingestion_logs;
