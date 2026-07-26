-- Up Migration

CREATE TABLE search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_query TEXT NOT NULL,
  extracted_intent JSONB,
  candidate_ids UUID[],
  ranked_ids UUID[],
  latency_ms INT,
  model_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS search_logs;
