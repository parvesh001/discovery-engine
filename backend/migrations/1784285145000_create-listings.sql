-- Up Migration

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  raw_description TEXT NOT NULL,
  price_per_night NUMERIC,
  bedrooms INT,
  location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  extracted_attributes JSONB,
  embedding VECTOR(1536),
  ingestion_status TEXT DEFAULT 'pending',  -- pending | processed | failed
  ingested_at TIMESTAMPTZ
);

CREATE INDEX idx_listings_embedding ON listings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_listings_attributes ON listings USING gin (extracted_attributes);

-- Down Migration

DROP TABLE IF EXISTS listings;
