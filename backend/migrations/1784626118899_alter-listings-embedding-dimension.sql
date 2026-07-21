-- Up Migration

DROP INDEX IF EXISTS idx_listings_embedding;
ALTER TABLE listings ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX idx_listings_embedding ON listings USING hnsw (embedding vector_cosine_ops);

-- Down Migration

DROP INDEX IF EXISTS idx_listings_embedding;
ALTER TABLE listings ALTER COLUMN embedding TYPE vector(1536);
CREATE INDEX idx_listings_embedding ON listings USING hnsw (embedding vector_cosine_ops);