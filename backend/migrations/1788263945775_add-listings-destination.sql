-- Up Migration

-- Authoritative demo-scope column (spec 12, Phase 11). Holds a lowercase destination
-- slug ('manali' | 'goa') for demo-dataset rows, left NULL for eval-dataset rows. Written
-- only by seed-demo.ts — never by ingestion, never from user input. Enforced as a real
-- SQL WHERE clause on browse / scoped search / scoped naive search (CLAUDE.md rule #2),
-- and never relaxed.
ALTER TABLE listings ADD COLUMN destination TEXT;

-- Partial index: only demo rows carry a destination, so NULL rows (the eval dataset) stay
-- out of the index entirely.
CREATE INDEX idx_listings_destination ON listings (destination) WHERE destination IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_listings_destination;
ALTER TABLE listings DROP COLUMN IF EXISTS destination;
